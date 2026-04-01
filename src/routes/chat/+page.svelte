<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import katex from 'katex';
	import { onMount } from 'svelte';

	interface Message {
		id?: number;
		role: string;
		content: string;
	}

	interface Conversation {
		id: number;
		title: string | null;
		model_id: number | null;
		created_at: string;
		updated_at: string;
	}

	interface ServerInfo {
		status: string;
		modelId: number | null;
		modelName: string | null;
		port: number;
		contextSize: number | null;
		lastTokensPerSecond: number | null;
	}

	interface SamplingParams {
		temperature: number;
		top_p: number;
		top_k: number;
		min_p: number;
		repeat_penalty: number;
	}

	const SAMPLING_DEFAULTS: SamplingParams = {
		temperature: 0.7,
		top_p: 0.95,
		top_k: 40,
		min_p: 0.05,
		repeat_penalty: 1.1
	};

	// Configure marked for safe rendering
	marked.setOptions({ breaks: true, gfm: true });

	let conversations = $state<Conversation[]>([]);
	let activeConversationId: number | null = $state(null);
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let abortController: AbortController | null = $state(null);
	let messagesContainer: HTMLDivElement | undefined = $state();
	let confirmDeleteId: number | null = $state(null);
	let sidebarOpen = $state(true);

	// Server/model info
	let serverInfo: ServerInfo | null = $state(null);

	// Sampling panel state
	let samplingOpen = $state(false);
	let temperature = $state(SAMPLING_DEFAULTS.temperature);
	let top_p = $state(SAMPLING_DEFAULTS.top_p);
	let top_k = $state(SAMPLING_DEFAULTS.top_k);
	let min_p = $state(SAMPLING_DEFAULTS.min_p);
	let repeat_penalty = $state(SAMPLING_DEFAULTS.repeat_penalty);
	let samplingSource = $state('default');
	let samplingModelId: number | null = $state(null);

	// Token usage tracking
	let tokenUsage: { prompt: number; completion: number; total: number } | null = $state(null);

	// Thinking block expansion tracking (collapsed by default, set tracks *expanded* ones)
	let expandedThinking = $state<Set<number>>(new Set());

	onMount(() => {
		loadConversations();
		const cleanupServerInfo = loadServerInfo();
		return () => cleanupServerInfo();
	});

	$effect(() => {
		if (messagesContainer && messages.length > 0) {
			messages[messages.length - 1]?.content;
			scrollToBottom();
		}
	});

	function scrollToBottom() {
		if (messagesContainer) {
			requestAnimationFrame(() => {
				if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	function loadServerInfo() {
		const es = new EventSource('/api/server/status');
		es.onmessage = (event) => {
			try {
				serverInfo = JSON.parse(event.data);
				if (serverInfo?.modelId && serverInfo.modelId !== samplingModelId) {
					samplingModelId = serverInfo.modelId;
					loadSamplingParams(serverInfo.modelId);
				}
			} catch {
				/* ignore */
			}
		};
		// Keep listening for updates (model load, t/s changes)
		return () => es.close();
	}

	async function loadSamplingParams(modelId: number) {
		try {
			const res = await fetch(`/api/models/${modelId}/sampling`);
			if (!res.ok) return;
			const params = await res.json();
			temperature = params.temperature;
			top_p = params.top_p;
			top_k = params.top_k;
			min_p = params.min_p;
			repeat_penalty = params.repeat_penalty;
			samplingSource = params.source;
		} catch {
			// defaults
		}
	}

	async function saveSamplingDefaults() {
		if (!samplingModelId) return;
		try {
			await fetch(`/api/models/${samplingModelId}/sampling`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ temperature, top_p, top_k, min_p, repeat_penalty })
			});
			samplingSource = 'user';
		} catch {
			/* ignore */
		}
	}

	function resetSampling() {
		temperature = SAMPLING_DEFAULTS.temperature;
		top_p = SAMPLING_DEFAULTS.top_p;
		top_k = SAMPLING_DEFAULTS.top_k;
		min_p = SAMPLING_DEFAULTS.min_p;
		repeat_penalty = SAMPLING_DEFAULTS.repeat_penalty;
		samplingSource = 'default';
	}

	async function loadConversations() {
		try {
			const res = await fetch('/api/conversations');
			if (res.ok) conversations = await res.json();
		} catch {
			/* ignore */
		}
	}

	async function newConversation() {
		activeConversationId = null;
		messages = [];
		input = '';
	}

	async function selectConversation(id: number) {
		activeConversationId = id;
		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (res.ok) {
				const data = await res.json();
				messages = data.messages ?? [];
			}
		} catch {
			messages = [];
		}
	}

	async function deleteConversation(id: number) {
		await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
		conversations = conversations.filter((c) => c.id !== id);
		if (activeConversationId === id) {
			activeConversationId = null;
			messages = [];
		}
		confirmDeleteId = null;
	}

	async function ensureConversation(): Promise<number> {
		if (activeConversationId) return activeConversationId;
		const title = input.trim().slice(0, 50) || 'New conversation';
		const res = await fetch('/api/conversations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title })
		});
		const data = await res.json();
		activeConversationId = data.id;
		await loadConversations();
		return data.id;
	}

	async function saveMessage(conversationId: number, role: string, content: string) {
		await fetch(`/api/conversations/${conversationId}/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role, content })
		});
	}

	async function sendMessage() {
		const text = input.trim();
		if (!text || streaming) return;
		const conversationId = await ensureConversation();
		messages = [...messages, { role: 'user', content: text }];
		input = '';
		await saveMessage(conversationId, 'user', text);
		messages = [...messages, { role: 'assistant', content: '' }];

		streaming = true;
		const controller = new AbortController();
		abortController = controller;

		try {
			const chatMessages = messages
				.slice(0, -1) // exclude the empty assistant placeholder we just added
				.filter((m) => m.content)
				.map((m) => ({ role: m.role, content: m.content }));

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: chatMessages,
					sampling: { temperature, top_p, top_k, min_p, repeat_penalty }
				}),
				signal: controller.signal
			});

			if (!res.ok) {
				const error = await res.json();
				messages = messages.map((m, i) =>
					i === messages.length - 1
						? { ...m, content: `Error: ${error.error ?? 'Request failed'}` }
						: m
				);
				streaming = false;
				abortController = null;
				return;
			}

			if (!res.body) {
				streaming = false;
				abortController = null;
				return;
			}

			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6).trim();
					if (data === '[DONE]') continue;
					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta?.content;
						if (delta) {
							messages = messages.map((m, i) =>
								i === messages.length - 1 ? { ...m, content: m.content + delta } : m
							);
						}
						if (parsed.usage) {
							tokenUsage = {
								prompt: parsed.usage.prompt_tokens ?? 0,
								completion: parsed.usage.completion_tokens ?? 0,
								total: parsed.usage.total_tokens ?? 0
							};
						}
					} catch {
						/* skip */
					}
				}
			}

			const finalContent = messages[messages.length - 1]?.content ?? '';
			if (finalContent) saveMessage(conversationId, 'assistant', finalContent);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				const partial = messages[messages.length - 1]?.content ?? '';
				if (partial) saveMessage(conversationId, 'assistant', partial);
			} else {
				messages = messages.map((m, i) =>
					i === messages.length - 1 ? { ...m, content: m.content || 'Error: Connection failed' } : m
				);
			}
		} finally {
			streaming = false;
			abortController = null;
		}
	}

	function stopGeneration() {
		abortController?.abort();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	function formatTime(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		return `${Math.floor(hrs / 24)}d`;
	}

	/**
	 * Parse thinking blocks from content.
	 * Supports <think>...</think> tags used by some models (Qwen, DeepSeek).
	 * Returns array of { type: 'text' | 'thinking', content: string } segments.
	 */
	function parseThinking(content: string): Array<{ type: 'text' | 'thinking'; content: string }> {
		const segments: Array<{ type: 'text' | 'thinking'; content: string }> = [];
		const regex = /<think>([\s\S]*?)(<\/think>|$)/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(content)) !== null) {
			if (match.index > lastIndex) {
				const text = content.slice(lastIndex, match.index).trim();
				if (text) segments.push({ type: 'text', content: text });
			}
			// Always include thinking segment, even if empty (shows "Thinking..." during streaming)
			const thinkContent = match[1].trim();
			segments.push({ type: 'thinking', content: thinkContent || '...' });
			lastIndex = regex.lastIndex;
		}

		if (lastIndex < content.length) {
			const text = content.slice(lastIndex).trim();
			if (text) segments.push({ type: 'text', content: text });
		}

		// If no thinking tags found, return single text segment
		if (segments.length === 0 && content.trim()) {
			segments.push({ type: 'text', content: content.trim() });
		}

		return segments;
	}

	function renderMath(text: string): string {
		// Block math: $$...$$
		text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
			try {
				return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
			} catch {
				return `<pre class="math-error">${math}</pre>`;
			}
		});
		// Inline math: $...$ (but not $$, and not inside code)
		text = text.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, math) => {
			try {
				return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
			} catch {
				return `<code>${math}</code>`;
			}
		});
		return text;
	}

	function renderMarkdown(text: string): string {
		const withMath = renderMath(text);
		const html = marked.parse(withMath, { async: false }) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: [
				'semantics',
				'annotation',
				'mrow',
				'mi',
				'mn',
				'mo',
				'msup',
				'msub',
				'mfrac',
				'mover',
				'munder',
				'msqrt',
				'mtext',
				'mspace',
				'mtable',
				'mtr',
				'mtd',
				'math'
			],
			ADD_ATTR: [
				'xmlns',
				'mathvariant',
				'stretchy',
				'fence',
				'separator',
				'accent',
				'accentunder',
				'columnalign',
				'columnspacing',
				'rowspacing',
				'displaystyle',
				'scriptlevel',
				'encoding',
				'lspace',
				'rspace',
				'movablelimits',
				'symmetric'
			]
		});
	}

	function toggleThinking(key: number) {
		const next = new Set(expandedThinking);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedThinking = next;
	}
</script>

<div class="-m-5 flex h-screen md:-m-8">
	<!-- Conversation sidebar -->
	<div
		class="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)] {sidebarOpen
			? ''
			: 'hidden'}"
	>
		<div
			class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5"
		>
			<span class="text-xs font-medium text-[var(--color-text-muted)]">Conversations</span>
			<button
				onclick={newConversation}
				class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)]"
				>New</button
			>
		</div>

		<div class="flex-1 overflow-y-auto">
			{#each conversations as conv}
				<div
					class="group flex items-center border-b border-[var(--color-border)]/30 {activeConversationId ===
					conv.id
						? 'bg-[var(--color-accent-subtle)]'
						: 'hover:bg-[var(--color-surface)]'}"
				>
					<button
						onclick={() => selectConversation(conv.id)}
						class="min-w-0 flex-1 px-3 py-2 text-left"
					>
						<p
							class="truncate text-xs text-[var(--color-text-secondary)] {activeConversationId ===
							conv.id
								? 'text-[var(--color-accent)]'
								: ''}"
						>
							{conv.title || 'Untitled'}
						</p>
						<p class="font-mono text-xs text-[var(--color-text-muted)]">
							{formatTime(conv.updated_at)}
						</p>
					</button>
					{#if confirmDeleteId === conv.id}
						<button
							onclick={() => deleteConversation(conv.id)}
							class="mr-1 px-1.5 py-0.5 text-xs text-red-400">Yes</button
						>
						<button
							onclick={() => (confirmDeleteId = null)}
							class="mr-2 text-xs text-[var(--color-text-muted)]">No</button
						>
					{:else}
						<button
							onclick={() => (confirmDeleteId = conv.id)}
							class="mr-2 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-400"
							>Del</button
						>
					{/if}
				</div>
			{/each}
			{#if conversations.length === 0}
				<p class="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">No conversations</p>
			{/if}
		</div>
	</div>

	<!-- Chat area -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header -->
		<div class="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
			<button
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
				aria-label="Toggle conversations"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
				</svg>
			</button>

			<span class="flex-1 text-xs font-medium text-[var(--color-text-secondary)]">
				{#if activeConversationId}
					{conversations.find((c) => c.id === activeConversationId)?.title || 'Chat'}
				{:else}
					New Chat
				{/if}
			</span>

			<!-- Model indicator -->
			{#if serverInfo?.status === 'ready' && serverInfo.modelName}
				<div
					class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
					<span
						class="max-w-48 truncate font-mono text-xs text-[var(--color-text-secondary)]"
						title={serverInfo.modelName}>{serverInfo.modelName}</span
					>
					{#if serverInfo.lastTokensPerSecond != null}
						<span class="font-mono text-xs text-[var(--color-accent)]"
							>{serverInfo.lastTokensPerSecond.toFixed(1)} t/s</span
						>
					{/if}
				</div>
			{:else if serverInfo?.status === 'starting'}
				<div
					class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
				>
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
					<span class="text-xs text-[var(--color-text-muted)]">Loading model...</span>
				</div>
			{:else}
				<div
					class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]"></span>
					<span class="text-xs text-[var(--color-text-muted)]">No model</span>
				</div>
			{/if}

			<button
				onclick={() => (samplingOpen = !samplingOpen)}
				class="rounded p-1 transition-colors {samplingOpen
					? 'text-[var(--color-accent)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				aria-label="Sampling parameters"
				title="Sampling parameters"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
					/>
				</svg>
			</button>
		</div>

		<!-- Sampling panel -->
		{#if samplingOpen}
			<div class="border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4">
				<div class="mx-auto max-w-3xl">
					<div class="mb-4 flex items-center justify-between">
						<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
							>Sampling</span
						>
						<div class="flex items-center gap-2">
							<span
								class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
								>{samplingSource}</span
							>
							<button
								onclick={resetSampling}
								class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
								>Reset</button
							>
							<button
								onclick={saveSamplingDefaults}
								class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40"
								>Save</button
							>
						</div>
					</div>
					<div class="grid grid-cols-5 gap-4">
						{#each [{ label: 'Temperature', value: temperature, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (temperature = v) }, { label: 'Top P', value: top_p, min: 0, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (top_p = v) }, { label: 'Top K', value: top_k, min: 0, max: 200, step: 1, fmt: (v: number) => String(v), set: (v: number) => (top_k = v) }, { label: 'Min P', value: min_p, min: 0, max: 1, step: 0.01, fmt: (v: number) => v.toFixed(2), set: (v: number) => (min_p = v) }, { label: 'Repeat', value: repeat_penalty, min: 0.5, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (repeat_penalty = v) }] as param}
							<div>
								<div class="mb-2 flex items-baseline justify-between">
									<span class="text-xs text-[var(--color-text-muted)]">{param.label}</span>
									<span class="font-mono text-xs font-medium text-[var(--color-text-primary)]"
										>{param.fmt(param.value)}</span
									>
								</div>
								<input
									type="range"
									value={param.value}
									oninput={(e) => param.set(parseFloat(e.currentTarget.value))}
									min={param.min}
									max={param.max}
									step={param.step}
									class="sampling-range w-full"
								/>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		<!-- Messages -->
		<div bind:this={messagesContainer} class="flex-1 overflow-y-auto px-4 py-6">
			{#if messages.length === 0}
				<div class="flex h-full flex-col items-center justify-center">
					{#if serverInfo?.status === 'ready' && serverInfo.modelName}
						<p class="font-mono text-sm text-[var(--color-text-secondary)]">
							{serverInfo.modelName}
						</p>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							Send a message to start chatting
						</p>
					{:else}
						<p class="text-sm text-[var(--color-text-muted)]">No model loaded</p>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							<a href="/models" class="text-[var(--color-accent)] hover:underline">Launch a model</a
							> to start chatting
						</p>
					{/if}
				</div>
			{:else}
				<div class="mx-auto max-w-3xl space-y-4">
					{#each messages as msg, idx}
						{#if msg.role === 'user'}
							<div class="flex justify-end">
								<div
									class="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-accent-dim)] px-4 py-2.5"
								>
									<p class="text-sm whitespace-pre-wrap text-white">{msg.content}</p>
								</div>
							</div>
						{:else}
							{@const segments = parseThinking(
								msg.content || (streaming && idx === messages.length - 1 ? '...' : '')
							)}
							<div class="max-w-[90%] space-y-2">
								{#each segments as segment, segIdx}
									{#if segment.type === 'thinking'}
										{@const isLast = idx === messages.length - 1}
										{@const isCollapsed =
											isLast && streaming ? false : !expandedThinking.has(idx * 100 + segIdx)}
										<div class="rounded-lg border border-amber-500/15 bg-amber-500/5">
											<button
												onclick={() => toggleThinking(idx * 100 + segIdx)}
												class="flex w-full items-center gap-2 px-3 py-2 text-left"
											>
												<svg
													class="h-3 w-3 shrink-0 text-amber-400 transition-transform {isCollapsed
														? ''
														: 'rotate-90'}"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="2"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
												</svg>
												<span class="text-xs font-medium text-amber-400">Thinking</span>
												{#if isCollapsed}
													<span class="truncate text-xs text-amber-400/50"
														>{segment.content.slice(0, 80)}...</span
													>
												{/if}
											</button>
											{#if !isCollapsed}
												<div class="border-t border-amber-500/10 px-3 py-2">
													<p class="text-xs leading-relaxed whitespace-pre-wrap text-amber-200/60">
														{segment.content}
													</p>
												</div>
											{/if}
										</div>
									{:else}
										<div
											class="chat-message rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
										>
											{@html renderMarkdown(segment.content)}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<!-- Input area -->
		<div class="border-t border-[var(--color-border)] px-4 py-3">
			<div class="mx-auto flex max-w-3xl gap-2">
				<textarea
					bind:value={input}
					onkeydown={handleKeydown}
					placeholder={serverInfo?.status === 'ready' ? 'Message...' : 'Load a model first...'}
					rows="1"
					disabled={streaming || serverInfo?.status !== 'ready'}
					class="max-h-[160px] min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
				></textarea>

				{#if streaming}
					<button
						onclick={stopGeneration}
						class="shrink-0 self-end rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
						>Stop</button
					>
				{:else}
					<button
						onclick={sendMessage}
						disabled={!input.trim() || serverInfo?.status !== 'ready'}
						class="shrink-0 self-end rounded-lg bg-[var(--color-accent-dim)] px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-30"
						>Send</button
					>
				{/if}
			</div>
			{#if tokenUsage}
				{@const ctxSize = serverInfo?.contextSize ?? 0}
				{@const usagePercent = ctxSize > 0 ? Math.round((tokenUsage.total / ctxSize) * 100) : 0}
				<div class="mx-auto mt-2 flex max-w-3xl items-center gap-3">
					{#if ctxSize > 0}
						<div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface)]">
							<div
								class="h-full rounded-full transition-all {usagePercent > 90
									? 'bg-red-400'
									: usagePercent > 70
										? 'bg-amber-400'
										: 'bg-[var(--color-accent)]'}"
								style="width: {Math.min(usagePercent, 100)}%"
							></div>
						</div>
					{/if}
					<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
						{tokenUsage.total.toLocaleString()}{ctxSize > 0 ? ` / ${ctxSize.toLocaleString()}` : ''} tokens
						<span class="text-[var(--color-text-muted)]/60"
							>({tokenUsage.prompt.toLocaleString()}p + {tokenUsage.completion.toLocaleString()}c)</span
						>
					</span>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.sampling-range {
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface);
		outline: none;
	}
	.sampling-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		cursor: pointer;
	}
	.sampling-range::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		cursor: pointer;
		border: none;
	}
	.sampling-range::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface);
	}

	/* Markdown rendering styles */
	:global(.chat-message) {
		font-size: 0.875rem;
		line-height: 1.625;
		color: var(--color-text-secondary);
	}
	:global(.chat-message p) {
		margin-bottom: 0.5rem;
	}
	:global(.chat-message p:last-child) {
		margin-bottom: 0;
	}
	:global(.chat-message strong) {
		color: var(--color-text-primary);
		font-weight: 600;
	}
	:global(.chat-message em) {
		font-style: italic;
	}
	:global(.chat-message code) {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.125rem 0.375rem;
	}
	:global(.chat-message pre) {
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0;
		overflow-x: auto;
	}
	:global(.chat-message pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-primary);
	}
	:global(.chat-message ul),
	:global(.chat-message ol) {
		padding-left: 1.25rem;
		margin: 0.5rem 0;
	}
	:global(.chat-message li) {
		margin-bottom: 0.25rem;
	}
	:global(.chat-message ul li) {
		list-style-type: disc;
	}
	:global(.chat-message ol li) {
		list-style-type: decimal;
	}
	:global(.chat-message h1),
	:global(.chat-message h2),
	:global(.chat-message h3) {
		color: var(--color-text-primary);
		font-weight: 600;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}
	:global(.chat-message h1) {
		font-size: 1.125rem;
	}
	:global(.chat-message h2) {
		font-size: 1rem;
	}
	:global(.chat-message h3) {
		font-size: 0.875rem;
	}
	:global(.chat-message blockquote) {
		border-left: 3px solid var(--color-accent);
		padding-left: 0.75rem;
		margin: 0.5rem 0;
		color: var(--color-text-muted);
	}
	:global(.chat-message a) {
		color: var(--color-accent);
		text-decoration: underline;
	}
	:global(.chat-message hr) {
		border-color: var(--color-border);
		margin: 0.75rem 0;
	}
	:global(.chat-message table) {
		border-collapse: collapse;
		margin: 0.5rem 0;
		font-size: 0.8125rem;
	}
	:global(.chat-message th),
	:global(.chat-message td) {
		border: 1px solid var(--color-border);
		padding: 0.375rem 0.625rem;
	}
	:global(.chat-message th) {
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-weight: 600;
	}
</style>
