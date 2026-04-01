<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import katex from 'katex';
	import { SvelteSet } from 'svelte/reactivity';

	interface Message {
		id: number;
		role: string;
		content: string;
	}

	let { conversationId }: { conversationId: number | null } = $props();
	let messages = $state<Message[]>([]);
	let loading = $state(false);

	marked.setOptions({ breaks: true, gfm: true });

	function renderMath(text: string): string {
		text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
			try {
				return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
			} catch {
				return `<pre class="math-error">${math}</pre>`;
			}
		});
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

	let expandedThinking = new SvelteSet<number>();

	function toggleThinking(key: number) {
		if (expandedThinking.has(key)) {
			expandedThinking.delete(key);
		} else {
			expandedThinking.add(key);
		}
	}

	async function loadMessages(id: number) {
		loading = true;
		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (res.ok) {
				const data = await res.json();
				messages = data.messages ?? [];
			}
		} catch {
			messages = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (conversationId) {
			loadMessages(conversationId);
		} else {
			messages = [];
		}
	});
</script>

<div class="flex-1 overflow-y-auto p-4">
	{#if !conversationId}
		<div class="flex h-full items-center justify-center">
			<p class="text-sm text-[var(--color-text-muted)]">Select a conversation</p>
		</div>
	{:else if loading}
		<div class="flex h-full items-center justify-center">
			<p class="text-sm text-[var(--color-text-muted)]">Loading...</p>
		</div>
	{:else if messages.length === 0}
		<div class="flex h-full items-center justify-center">
			<p class="text-sm text-[var(--color-text-muted)]">No messages</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each messages as msg, idx (msg.id)}
				{#if msg.role === 'user'}
					<div class="flex justify-end">
						<div
							class="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-accent-dim)] px-4 py-2.5"
						>
							<p class="text-sm whitespace-pre-wrap text-white">{msg.content}</p>
						</div>
					</div>
				{:else if msg.role === 'assistant'}
					{@const segments = parseThinking(msg.content)}
					<div class="max-w-[90%]">
						{#each segments as seg, segIdx (segIdx)}
							{#if seg.type === 'thinking'}
								{@const thinkKey = idx * 1000 + segIdx}
								{@const isExpanded = expandedThinking.has(thinkKey)}
								<div
									class="mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
								>
									<button
										onclick={() => toggleThinking(thinkKey)}
										class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-muted)]"
									>
										<svg
											class="h-3 w-3 transition-transform {isExpanded ? 'rotate-90' : ''}"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
										</svg>
										Thinking
									</button>
									{#if isExpanded}
										<div class="border-t border-[var(--color-border)] px-3 py-2">
											<div
												class="prose-sm max-w-none text-sm text-[var(--color-text-muted)] prose-invert"
											>
												{@html renderMarkdown(seg.content)}
											</div>
										</div>
									{/if}
								</div>
							{:else}
								<div
									class="prose-sm max-w-none text-sm text-[var(--color-text-primary)] prose-invert"
								>
									{@html renderMarkdown(seg.content)}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
