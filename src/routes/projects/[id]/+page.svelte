<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { renderMarkdown } from '$lib/markdown';
	import 'highlight.js/styles/github-dark.css';
	import FileTree from '$lib/components/FileTree.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import SessionList from '$lib/components/SessionList.svelte';

	interface Project {
		id: number;
		name: string;
		path: string;
		created_at: string;
	}

	interface FileEntry {
		name: string;
		type: 'file' | 'directory';
	}

	interface ToolCallData {
		id: string;
		function: { name: string; arguments: string };
	}

	interface DangerSegment {
		segment: string;
		label: string;
		startIndex: number;
		endIndex: number;
	}

	interface ApprovalRequest {
		requestId: string;
		command: string;
		dangers: DangerSegment[];
		sandboxed: boolean;
		resolved: boolean;
		approved: boolean | null;
	}

	interface SandboxBlocked {
		paths: string[];
		absolutePaths: string[];
		resolved?: boolean;
		allowedPath?: string;
	}

	interface Message {
		id?: number;
		role: string;
		content: string;
		tool_calls?: ToolCallData[] | null;
		tool_call_id?: string | null;
		toolName?: string;
		toolArgs?: string;
		toolStatus?: 'running' | 'done';
		approval?: ApprovalRequest;
		sandboxBlocked?: SandboxBlocked;
	}

	interface ServerInfo {
		status: string;
		modelId: number | null;
		modelName: string | null;
		port: number;
		contextSize: number | null;
		lastTokensPerSecond: number | null;
	}

	const projectId = parseInt(page.params.id ?? '0');

	let project = $state<Project | null>(null);
	let fileEntries = $state<FileEntry[]>([]);
	let activeTab = $state<'chat' | 'files'>('chat');
	let selectedFilePath = $state<string | null>(null);

	// Chat state
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let abortController: AbortController | null = $state(null);
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let messagesContainer: HTMLDivElement | undefined = $state();
	let tokenUsage: { prompt: number; completion: number; total: number } | null = $state(null);
	let expandedTools = $state<Set<number>>(new Set());
	let changedFiles = $state<Map<string, 'created' | 'modified'>>(new Map());

	// Conversation state
	let activeConversationId: number | null = $state(null);

	// Server info
	let serverInfo: ServerInfo | null = $state(null);

	// Session list ref
	let sessionListComponent: SessionList | undefined = $state();

	// File tree ref
	let fileTreeRef: FileTree | undefined = $state();

	let cleanupServerInfo: (() => void) | null = null;

	onMount(() => {
		loadProject();
		loadFiles();
		loadGitStatus();
		cleanupServerInfo = loadServerInfo();
		return () => {
			cleanupServerInfo?.();
		};
	});

	async function loadProject() {
		try {
			const res = await fetch(`/api/projects/${projectId}`);
			if (res.ok) {
				project = await res.json();
			} else {
				goto('/projects');
			}
		} catch {
			goto('/projects');
		}
	}

	async function loadGitStatus() {
		try {
			const res = await fetch(`/api/projects/${projectId}/status`);
			if (res.ok) {
				const data = await res.json();
				if (data.isGit && data.files.length > 0) {
					const newChanged = new Map<string, 'created' | 'modified'>();
					for (const f of data.files) {
						newChanged.set(f.path, f.operation);
					}
					changedFiles = newChanged;
				}
			}
		} catch {
			// Not critical
		}
	}

	async function loadFiles() {
		try {
			const res = await fetch(`/api/projects/${projectId}/files`);
			if (res.ok) {
				const data = await res.json();
				fileEntries = data.entries;
			}
		} catch {
			// ignore
		}
	}

	function loadServerInfo() {
		const es = new EventSource('/api/server/status');
		es.onmessage = (event) => {
			try {
				serverInfo = JSON.parse(event.data);
			} catch {
				/* ignore */
			}
		};
		return () => es.close();
	}

	function enrichToolMessages(msgs: Message[]): Message[] {
		const toolCallMap = new Map<string, ToolCallData>();
		return msgs.map((msg) => {
			if (msg.role === 'assistant' && msg.tool_calls) {
				for (const tc of msg.tool_calls) {
					toolCallMap.set(tc.id, tc);
				}
			}
			if (msg.role === 'tool' && msg.tool_call_id) {
				const tc = toolCallMap.get(msg.tool_call_id);
				return {
					...msg,
					toolName: tc?.function.name ?? 'tool',
					toolArgs: tc?.function.arguments,
					toolStatus: 'done' as const
				};
			}
			return msg;
		});
	}

	async function selectConversation(id: number) {
		activeConversationId = id;
		changedFiles = new Map();
		activeTab = 'chat';
		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (res.ok) {
				const data = await res.json();
				messages = enrichToolMessages(data.messages ?? []);
			}
		} catch {
			messages = [];
		}
	}

	async function newConversation() {
		activeConversationId = null;
		messages = [];
		input = '';
		tokenUsage = null;
		changedFiles = new Map();
		activeTab = 'chat';
	}

	async function ensureConversation(): Promise<number> {
		if (activeConversationId) return activeConversationId;

		const modelId = serverInfo?.modelId ?? null;
		if (!modelId) throw new Error('No model running');

		const title = input.trim().slice(0, 50) || 'New conversation';
		const res = await fetch(`/api/projects/${projectId}/conversations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, modelId })
		});
		const data = await res.json();
		activeConversationId = data.id;
		sessionListComponent?.loadConversations();
		return data.id;
	}

	async function saveMessage(
		conversationId: number,
		role: string,
		content: string,
		opts?: { toolCallId?: string; toolCalls?: string; tokenCount?: number }
	): Promise<number | null> {
		try {
			const res = await fetch(`/api/conversations/${conversationId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					role,
					content,
					...(opts?.toolCallId && { toolCallId: opts.toolCallId }),
					...(opts?.toolCalls && { toolCalls: opts.toolCalls }),
					...(opts?.tokenCount != null && { tokenCount: opts.tokenCount })
				})
			});
			if (res.ok) {
				const data = await res.json();
				return data.id;
			}
		} catch {
			// ignore
		}
		return null;
	}

	function toggleTool(key: number) {
		const next = new Set(expandedTools);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedTools = next;
	}

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

	// Attach click handlers to code copy buttons after render
	$effect(() => {
		void messages.length;
		tick().then(() => {
			document.querySelectorAll('.code-copy').forEach((btn) => {
				if (btn.getAttribute('data-wired')) return;
				btn.setAttribute('data-wired', '1');
				btn.addEventListener('click', () => {
					const block = btn.closest('.code-block');
					const code = block?.querySelector('code');
					if (!code) return;
					const raw = code.innerText;
					navigator.clipboard.writeText(raw).then(() => {
						btn.textContent = 'Copied!';
						setTimeout(() => {
							btn.textContent = 'Copy';
						}, 1500);
					});
				});
			});
		});
	});

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
			const thinkContent = match[1].trim();
			segments.push({ type: 'thinking', content: thinkContent || '...' });
			lastIndex = regex.lastIndex;
		}
		if (lastIndex < content.length) {
			const text = content.slice(lastIndex).trim();
			if (text) segments.push({ type: 'text', content: text });
		}
		if (segments.length === 0 && content.trim()) {
			segments.push({ type: 'text', content: content.trim() });
		}
		return segments;
	}

	function linkifyText(text: string): string {
		const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return escaped.replace(
			/(https?:\/\/[^\s<]+)/g,
			'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
		);
	}

	function highlightDangers(command: string, dangers: DangerSegment[]): string {
		if (dangers.length === 0) {
			return command.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
		const sorted = [...dangers].sort((a, b) => a.startIndex - b.startIndex);
		let result = '';
		let pos = 0;
		for (const d of sorted) {
			const before = command.slice(pos, d.startIndex);
			const dangerous = command.slice(d.startIndex, d.endIndex);
			result +=
				before.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
				`<span class="text-red-400 font-semibold" title="${d.label}">${dangerous.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
			pos = d.endIndex;
		}
		const tail = command.slice(pos);
		result += tail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return result;
	}

	async function handleApproval(requestId: string, approved: boolean, remember = false) {
		try {
			await fetch('/api/approve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestId, approved, remember })
			});
		} catch {
			// ignore
		}
		// Mark approval as resolved in messages
		messages = messages.map((m) => {
			if (m.approval?.requestId === requestId) {
				return {
					...m,
					approval: { ...m.approval, resolved: true, approved }
				};
			}
			return m;
		});
	}

	async function handleAllowPath(absolutePath: string, displayPath: string) {
		try {
			await fetch('/api/sandbox/allow-path', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: absolutePath })
			});
		} catch {
			// ignore
		}
		messages = messages.map((m) => {
			if (m.sandboxBlocked && m.sandboxBlocked.absolutePaths.includes(absolutePath)) {
				return {
					...m,
					sandboxBlocked: { ...m.sandboxBlocked, resolved: true, allowedPath: displayPath }
				};
			}
			return m;
		});
	}

	async function sendMessage() {
		const text = input.trim();
		if (!text || streaming) return;

		let conversationId: number;
		try {
			conversationId = await ensureConversation();
		} catch {
			return;
		}

		messages = [...messages, { role: 'user', content: text }];
		input = '';
		await saveMessage(conversationId, 'user', text);
		messages = [...messages, { role: 'assistant', content: '' }];

		streaming = true;
		const controller = new AbortController();
		abortController = controller;

		const pendingToolMessages: Array<{
			role: string;
			content: string;
			toolCalls?: string;
			toolCallId?: string;
		}> = [];
		const toolStatusIndices = new Map<string, number>();

		try {
			const allowedRoles = new Set(['user', 'assistant', 'tool', 'system']);
			const chatMessages = messages
				.slice(0, -1)
				.filter((m) => allowedRoles.has(m.role))
				.map((m) => {
					const msg: Record<string, unknown> = { role: m.role, content: m.content };
					if (m.tool_calls) msg.tool_calls = m.tool_calls;
					if (m.tool_call_id) {
						msg.role = 'tool';
						msg.tool_call_id = m.tool_call_id;
					}
					return msg;
				});

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: chatMessages,
					tools_enabled: true,
					model_id: serverInfo?.modelId ?? null,
					project_id: projectId
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
			let currentToolCalls: ToolCallData[] = [];

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

						if (parsed.type === 'delta') {
							// Ensure there's an assistant message to append to
							const lastMsg = messages[messages.length - 1];
							if (!lastMsg || lastMsg.role !== 'assistant') {
								messages = [...messages, { role: 'assistant', content: '' }];
							}
							messages = messages.map((m, i) =>
								i === messages.length - 1 ? { ...m, content: m.content + parsed.content } : m
							);
						} else if (parsed.type === 'tool_call') {
							const tc: ToolCallData = {
								id: parsed.id,
								function: { name: parsed.name, arguments: parsed.arguments }
							};
							currentToolCalls.push(tc);

							const statusIdx = messages.length;
							toolStatusIndices.set(parsed.id, statusIdx);
							messages = [
								...messages,
								{
									role: 'tool_status',
									content: '',
									toolName: parsed.name,
									toolArgs: parsed.arguments,
									toolStatus: 'running',
									tool_call_id: parsed.id
								}
							];
						} else if (parsed.type === 'tool_result') {
							const statusIdx = toolStatusIndices.get(parsed.id);
							if (statusIdx !== undefined) {
								messages = messages.map((m, i) =>
									i === statusIdx
										? { ...m, content: parsed.content, toolStatus: 'done' as const }
										: m
								);
							}

							if (currentToolCalls.length > 0) {
								const lastAssistant = messages[messages.length - currentToolCalls.length - 1];
								const assistantContent =
									lastAssistant?.role === 'assistant' ? lastAssistant.content : '';
								pendingToolMessages.push({
									role: 'assistant',
									content: assistantContent,
									toolCalls: JSON.stringify(currentToolCalls)
								});
								currentToolCalls = [];
							}

							pendingToolMessages.push({
								role: 'tool',
								content: parsed.content,
								toolCallId: parsed.id
							});
						} else if (parsed.type === 'usage') {
							tokenUsage = {
								prompt: parsed.prompt_tokens ?? 0,
								completion: parsed.completion_tokens ?? 0,
								total: parsed.total_tokens ?? 0
							};
						} else if (parsed.type === 'approval_request') {
							messages = [
								...messages,
								{
									role: 'approval',
									content: '',
									approval: {
										requestId: parsed.requestId,
										command: parsed.command,
										dangers: parsed.dangers ?? [],
										sandboxed: parsed.sandboxed ?? true,
										resolved: false,
										approved: null
									}
								}
							];
						} else if (parsed.type === 'sandbox_blocked') {
							messages = [
								...messages,
								{
									role: 'sandbox_blocked',
									content: '',
									sandboxBlocked: {
										paths: parsed.paths ?? [],
										absolutePaths: parsed.absolutePaths ?? []
									}
								}
							];
						} else if (parsed.type === 'file_changed') {
							const newChanged = new Map(changedFiles);
							newChanged.set(parsed.path, parsed.operation);
							changedFiles = newChanged;

							if (parsed.operation === 'created') {
								const parentDir = parsed.path.includes('/')
									? parsed.path.substring(0, parsed.path.lastIndexOf('/'))
									: '';
								fileTreeRef?.refreshDirectory(parentDir);
							}
						}
					} catch {
						/* skip */
					}
				}
			}

			for (const tm of pendingToolMessages) {
				await saveMessage(conversationId, tm.role, tm.content, {
					toolCalls: tm.toolCalls,
					toolCallId: tm.toolCallId
				});
			}

			const lastMsg = messages[messages.length - 1];
			if (lastMsg?.role === 'assistant' && lastMsg.content) {
				await saveMessage(conversationId, 'assistant', lastMsg.content);
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				for (const tm of pendingToolMessages) {
					await saveMessage(conversationId, tm.role, tm.content, {
						toolCalls: tm.toolCalls,
						toolCallId: tm.toolCallId
					});
				}
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === 'assistant' && lastMsg.content) {
					await saveMessage(conversationId, 'assistant', lastMsg.content);
				}
			} else {
				messages = messages.map((m, i) =>
					i === messages.length - 1 ? { ...m, content: m.content || 'Error: Connection failed' } : m
				);
			}
		} finally {
			streaming = false;
			abortController = null;
			sessionListComponent?.loadConversations();
			tick().then(() => textareaEl?.focus());
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

	function handleFileSelect(path: string) {
		selectedFilePath = path;
		activeTab = 'files';
	}
</script>

{#if !project}
	<div class="flex h-screen items-center justify-center">
		<p class="text-sm text-[var(--color-text-muted)]">Loading project...</p>
	</div>
{:else}
	<div class="workspace-container -m-5 flex h-screen flex-col md:-m-8">
		<!-- Top bar -->
		<div
			class="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2"
		>
			<div class="flex items-center gap-3">
				<a
					href="/projects"
					title="Back to projects"
					class="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
					</svg>
				</a>
				<span class="text-sm font-medium text-[var(--color-text-primary)]">{project.name}</span>
				<span class="font-mono text-xs text-[var(--color-text-muted)]">{project.path}</span>
			</div>
			<div class="flex items-center gap-2">
				{#if serverInfo?.status === 'ready' && serverInfo.modelName}
					<div
						class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
						<span class="max-w-48 truncate font-mono text-xs text-[var(--color-text-secondary)]">
							{serverInfo.modelName}
						</span>
						{#if serverInfo.lastTokensPerSecond != null}
							<span class="font-mono text-xs text-[var(--color-accent)]">
								{serverInfo.lastTokensPerSecond.toFixed(1)} t/s
							</span>
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
			</div>
		</div>

		<!-- Main area -->
		<div class="flex min-h-0 flex-1">
			<!-- Left panel: File tree + Sessions -->
			<div
				class="flex w-[250px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)]"
			>
				<!-- File tree -->
				<div class="flex min-h-0 flex-1 flex-col">
					<div
						class="flex items-center justify-between border-b border-[var(--color-border)] px-2 py-1.5"
					>
						<span
							class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
						>
							Files
						</span>
						<button
							onclick={loadFiles}
							class="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
							title="Refresh"
						>
							<svg
								class="h-3 w-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
								/>
							</svg>
						</button>
					</div>
					<div class="flex-1 overflow-y-auto px-1 py-1">
						<FileTree
							bind:this={fileTreeRef}
							{projectId}
							entries={fileEntries}
							{changedFiles}
							onFileSelect={handleFileSelect}
						/>
					</div>
				</div>

				<!-- Sessions -->
				<div
					class="flex max-h-[40%] shrink-0 flex-col border-t border-[var(--color-border)] px-1 py-2"
				>
					<SessionList
						bind:this={sessionListComponent}
						{projectId}
						{activeConversationId}
						modelId={serverInfo?.modelId ?? null}
						onSelect={selectConversation}
						onNew={newConversation}
					/>
				</div>
			</div>

			<!-- Right panel: Content area -->
			<div class="flex min-w-0 flex-1 flex-col">
				<!-- Tabs -->
				<div class="flex border-b border-[var(--color-border)]">
					<button
						onclick={() => (activeTab = 'chat')}
						class="border-b-2 px-4 py-2 text-xs font-medium transition-colors
							{activeTab === 'chat'
							? 'border-[var(--color-accent)] text-[var(--color-accent)]'
							: 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
					>
						Chat
					</button>
					<button
						onclick={() => (activeTab = 'files')}
						class="border-b-2 px-4 py-2 text-xs font-medium transition-colors
							{activeTab === 'files'
							? 'border-[var(--color-accent)] text-[var(--color-accent)]'
							: 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
					>
						Files
						{#if selectedFilePath}
							<span class="ml-1 text-[var(--color-text-muted)]">
								- {selectedFilePath.split('/').pop()}
							</span>
						{/if}
					</button>
				</div>

				<!-- Tab content -->
				{#if activeTab === 'chat'}
					<!-- Chat messages -->
					<div bind:this={messagesContainer} class="flex-1 overflow-y-auto px-4 py-4">
						{#if messages.length === 0}
							<div class="flex h-full flex-col items-center justify-center">
								{#if serverInfo?.status === 'ready'}
									<p class="text-sm text-[var(--color-text-secondary)]">
										Start a conversation about {project.name}
									</p>
									<p class="mt-1 text-xs text-[var(--color-text-muted)]">
										The model has access to project files and can run commands
									</p>
								{:else}
									<p class="text-sm text-[var(--color-text-muted)]">No model loaded</p>
									<p class="mt-1 text-xs text-[var(--color-text-muted)]">
										<a href="/models" class="text-[var(--color-accent)] hover:underline"
											>Launch a model</a
										> to start
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
												<p class="user-content text-sm whitespace-pre-wrap text-white">
													{@html linkifyText(msg.content)}
												</p>
											</div>
										</div>
									{:else if msg.role === 'tool_status'}
										{@const isExpanded = expandedTools.has(idx)}
										{@const toolSummary = (() => {
											try {
												const args = JSON.parse(msg.toolArgs ?? '{}');
												if (msg.toolName === 'fetch_url' && args.url) return args.url;
												if (msg.toolName === 'web_search' && args.query) return `"${args.query}"`;
												if (msg.toolName === 'run_command' && args.command)
													return args.command.slice(0, 60);
												if (msg.toolName === 'read_file' && args.path) return args.path;
												if (msg.toolName === 'write_file' && args.path) return args.path;
												return '';
											} catch {
												return '';
											}
										})()}
										<div
											class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] border-l-cyan-500/40 bg-[var(--color-elevated)]"
										>
											<button
												onclick={() => toggleTool(idx)}
												class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
											>
												<svg
													class="h-3 w-3 shrink-0 text-cyan-400 transition-transform {isExpanded
														? 'rotate-90'
														: ''}"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="2"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
												</svg>
												<svg
													class="h-3 w-3 shrink-0 text-cyan-400/70"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.5"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
													/>
												</svg>
												<span class="text-xs font-medium text-cyan-400/80">
													{msg.toolName ?? 'tool'}
												</span>
												{#if toolSummary}
													<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]">
														{toolSummary}
													</span>
												{/if}
												{#if msg.toolStatus === 'running'}
													<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cyan-400"
													></span>
												{:else}
													<svg
														class="h-3 w-3 shrink-0 text-emerald-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="2"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M5 13l4 4L19 7"
														/>
													</svg>
												{/if}
											</button>
											{#if isExpanded}
												<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
													{#if msg.toolArgs}
														<p class="font-mono text-xs break-all text-cyan-300/60">
															{msg.toolArgs}
														</p>
													{/if}
													{#if msg.toolStatus === 'done' && msg.content}
														<p
															class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
														>
															{msg.content}
														</p>
													{/if}
												</div>
											{/if}
										</div>
									{:else if msg.role === 'tool'}
										{@const isExpanded = expandedTools.has(idx)}
										<div
											class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] border-l-cyan-500/40 bg-[var(--color-elevated)]"
										>
											<button
												onclick={() => toggleTool(idx)}
												class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
											>
												<svg
													class="h-3 w-3 shrink-0 text-cyan-400 transition-transform {isExpanded
														? 'rotate-90'
														: ''}"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="2"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
												</svg>
												<svg
													class="h-3 w-3 shrink-0 text-cyan-400/70"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.5"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
													/>
												</svg>
												<span class="text-xs font-medium text-cyan-400/80">
													{msg.toolName ?? 'Tool result'}
												</span>
												<svg
													class="h-3 w-3 shrink-0 text-emerald-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="2"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
												</svg>
											</button>
											{#if isExpanded}
												<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
													{#if msg.toolArgs}
														<p class="font-mono text-xs break-all text-cyan-300/60">
															{msg.toolArgs}
														</p>
													{/if}
													<p
														class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
													>
														{msg.content}
													</p>
												</div>
											{/if}
										</div>
									{:else if msg.role === 'approval'}
										{@const approval = msg.approval}
										{#if approval}
											<div
												class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)]
													{approval.resolved
													? approval.approved
														? 'border-l-emerald-500/60'
														: 'border-l-red-500/60'
													: 'border-l-amber-500/60'}"
											>
												<div class="px-3 py-2">
													{#if !approval.sandboxed}
														<div
															class="mb-2 flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-1"
														>
															<svg
																class="h-3.5 w-3.5 shrink-0 text-red-400"
																fill="none"
																stroke="currentColor"
																viewBox="0 0 24 24"
																stroke-width="1.5"
															>
																<path
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
																/>
															</svg>
															<span class="text-xs font-medium text-red-400">Unsandboxed</span>
														</div>
													{/if}
													<div class="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
														Command approval required:
													</div>
													<pre
														class="mb-2 overflow-x-auto rounded bg-[var(--color-surface)] p-2 font-mono text-xs text-[var(--color-text-primary)]">{@html highlightDangers(
															approval.command,
															approval.dangers
														)}</pre>
													{#if !approval.resolved}
														<div class="flex items-center gap-2">
															<button
																onclick={() => handleApproval(approval.requestId, true)}
																class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
															>
																Approve
															</button>
															<button
																onclick={() => handleApproval(approval.requestId, true, true)}
																class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
															>
																Always Allow
															</button>
															<button
																onclick={() => handleApproval(approval.requestId, false)}
																class="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
															>
																Deny
															</button>
														</div>
													{:else}
														<span
															class="text-xs font-medium {approval.approved
																? 'text-emerald-400'
																: 'text-red-400'}"
														>
															{approval.approved ? 'Approved' : 'Denied'}
														</span>
													{/if}
												</div>
											</div>
										{/if}
									{:else if msg.role === 'sandbox_blocked'}
										{@const sb = msg.sandboxBlocked}
										{#if sb}
											<div
												class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)]
													{sb.resolved ? 'border-l-emerald-500/60' : 'border-l-amber-500/60'}"
											>
												<div class="px-3 py-2">
													<div
														class="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400"
													>
														<svg
															class="h-3.5 w-3.5 shrink-0"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.5"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
															/>
														</svg>
														Sandbox blocked writes to:
													</div>
													{#each sb.paths as displayPath, i}
														<div class="mb-1 font-mono text-xs text-[var(--color-text-primary)]">
															{displayPath}
														</div>
														{#if !sb.resolved}
															<div class="mb-2 flex items-center gap-2">
																<button
																	onclick={() => handleAllowPath(sb.absolutePaths[i], displayPath)}
																	class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
																>
																	Allow {displayPath}
																</button>
															</div>
														{/if}
													{/each}
													{#if sb.resolved}
														<span class="text-xs font-medium text-emerald-400">
															Path allowed. Re-run the command for it to take effect.
														</span>
													{/if}
												</div>
											</div>
										{/if}
									{:else if msg.role === 'assistant'}
										{@const isWaiting = !msg.content && streaming && idx === messages.length - 1}
										{@const segments = parseThinking(msg.content || (isWaiting ? '...' : ''))}
										<div class="max-w-[90%] space-y-2">
											{#if isWaiting}
												<div
													class="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
												>
													<span class="thinking-dots flex gap-1">
														<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
														<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
														<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
													</span>
												</div>
											{/if}
											{#each isWaiting ? [] : segments as segment}
												{#if segment.type === 'thinking'}
													<div class="rounded-lg border border-amber-500/15 bg-amber-500/5">
														<div class="px-3 py-2">
															<span class="text-xs font-medium text-amber-400">Thinking</span>
															<p
																class="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-amber-200/60"
															>
																{segment.content}
															</p>
														</div>
													</div>
												{:else}
													<div
														class="chat-message assistant-content rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
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
								bind:this={textareaEl}
								bind:value={input}
								onkeydown={handleKeydown}
								placeholder={serverInfo?.status === 'ready'
									? 'Message...'
									: 'Load a model first...'}
								rows="1"
								disabled={streaming || serverInfo?.status !== 'ready'}
								class="max-h-[160px] min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
							></textarea>

							{#if streaming}
								<button
									onclick={stopGeneration}
									class="shrink-0 self-end rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
								>
									Stop
								</button>
							{:else}
								<button
									onclick={sendMessage}
									disabled={!input.trim() || serverInfo?.status !== 'ready'}
									class="shrink-0 self-end rounded-lg bg-[var(--color-accent-dim)] px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-30"
								>
									Send
								</button>
							{/if}
						</div>
						{#if tokenUsage}
							{@const ctxSize = serverInfo?.contextSize ?? 0}
							{@const usagePercent =
								ctxSize > 0 ? Math.round((tokenUsage.total / ctxSize) * 100) : 0}
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
									{tokenUsage.total.toLocaleString()}{ctxSize > 0
										? ` / ${ctxSize.toLocaleString()}`
										: ''} tokens
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<!-- File preview -->
					<div class="flex-1">
						<FilePreview {projectId} filePath={selectedFilePath} />
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.workspace-container {
		margin: -1.25rem;
		margin-top: -3.5rem;
		height: 100vh;
	}

	@media (min-width: 768px) {
		.workspace-container {
			margin: -2rem;
			margin-top: -2rem;
		}
	}

	.thinking-dots span {
		animation: thinking-bounce 1.4s infinite ease-in-out;
	}
	.thinking-dots span:nth-child(1) {
		animation-delay: 0s;
	}
	.thinking-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.thinking-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes thinking-bounce {
		0%,
		80%,
		100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}
	:global(.user-content a) {
		color: white;
		text-decoration: underline;
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
		opacity: 0.9;
	}
	:global(.user-content a:hover) {
		opacity: 1;
	}
	:global(.assistant-content .code-block) {
		margin: 0.75rem 0;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		background: #0d1117;
	}
	:global(.assistant-content .code-block .code-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.75rem;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.03);
		border-bottom: 1px solid var(--color-border);
		font-family: ui-monospace, monospace;
	}
	:global(.assistant-content .code-block .code-copy) {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		font-family: inherit;
	}
	:global(.assistant-content .code-block .code-copy:hover) {
		color: var(--color-text-secondary);
		background: rgba(255, 255, 255, 0.06);
	}
	:global(.assistant-content .code-content) {
		margin: 0;
		padding: 0.5rem 0.75rem 0.5rem 0;
		font-size: 0.8rem;
		line-height: 1.4;
		overflow-x: auto;
	}
	:global(.assistant-content .code-content code) {
		background: none;
		padding: 0;
		counter-reset: line;
	}
	:global(.assistant-content .code-content code .line) {
		display: block;
	}
	:global(.assistant-content .code-content code .line::before) {
		counter-increment: line;
		content: counter(line);
		display: inline-block;
		width: 3ch;
		margin-right: 1rem;
		padding-right: 0.5rem;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.35;
		border-right: 1px solid var(--color-border);
		user-select: none;
		-webkit-user-select: none;
	}
	:global(.assistant-content .code-block .hljs) {
		background: none;
	}
	:global(.assistant-content a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: var(--color-accent);
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
	}
	:global(.assistant-content a:hover) {
		text-decoration-thickness: 2px;
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
