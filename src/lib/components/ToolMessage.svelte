<script lang="ts">
	import type { Message } from '$lib/types/chat';
	import {
		getToolSummary,
		getToolLabel,
		getToolElapsed,
		getToolOutputPreview
	} from '$lib/utils/chat';
	import { buildSrcdoc } from '$lib/utils/html-toolkit';

	interface DiffLine {
		type: '+' | '-' | ' ';
		lineNum: number;
		content: string;
	}

	function extractDiffSnippet(content: string): { summary: string; diff: DiffLine[] | null } {
		const lines = content.split('\n');
		const diffLines: DiffLine[] = [];
		const summaryLines: string[] = [];
		let inDiff = false;

		for (const line of lines) {
			const match = line.match(/^([+ -]):(\d+):(.*)$/);
			if (match) {
				inDiff = true;
				diffLines.push({
					type: match[1] as '+' | '-' | ' ',
					lineNum: parseInt(match[2]),
					content: match[3]
				});
			} else if (!inDiff) {
				summaryLines.push(line);
			}
		}

		return {
			summary: summaryLines.join('\n').trim(),
			diff: diffLines.length > 0 ? diffLines : null
		};
	}

	function extractHtmlFromArgs(toolArgs: string | undefined): string | null {
		if (!toolArgs) return null;
		try {
			const parsed = JSON.parse(toolArgs);
			if (typeof parsed.html !== 'string' || parsed.html.length === 0) return null;
			return parsed.html.replace(/\\`/g, '`').replace(/\\\$/g, '$');
		} catch {
			return null;
		}
	}

	interface Props {
		msg: Message;
		isExpanded: boolean;
		ontoggle: () => void;
	}

	let { msg, isExpanded, ontoggle }: Props = $props();

	let toolSummary = $derived(getToolSummary(msg.toolName, msg.toolArgs));
	let parsed = $derived(
		msg.role === 'tool_status'
			? msg.toolStatus === 'done' && msg.content
				? extractDiffSnippet(msg.content)
				: null
			: msg.content
				? extractDiffSnippet(msg.content)
				: null
	);
	let htmlContent = $derived(
		msg.toolName === 'render_html' ? extractHtmlFromArgs(msg.toolArgs) : null
	);
	let showIframe = $derived(
		msg.role === 'tool_status'
			? msg.toolName === 'render_html' && msg.toolStatus === 'done' && !msg.toolError && htmlContent
			: msg.toolName === 'render_html' && !msg.toolError && htmlContent
	);
</script>

<div
	class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)] {msg.toolError
		? 'border-l-red-500/40'
		: 'border-l-cyan-500/40'}"
>
	<button onclick={ontoggle} class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
		<svg
			class="h-3 w-3 shrink-0 text-cyan-400 transition-transform {isExpanded ? 'rotate-90' : ''}"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			stroke-width="2"
		>
			<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
		</svg>
		{#if msg.role === 'tool_status'}
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
		{:else}
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
					d="M11.42 15.17l-5.09-5.09a3.004 3.004 0 010-4.25 3.004 3.004 0 014.25 0l.34.34.34-.34a3.004 3.004 0 014.25 0 3.004 3.004 0 010 4.25l-5.09 5.09zM21.17 8.04l-4.25-4.25a2 2 0 00-2.83 0L12 5.88l-2.09-2.09a2 2 0 00-2.83 0L2.83 8.04a2 2 0 000 2.83L12 20l9.17-9.13a2 2 0 000-2.83z"
				/>
			</svg>
		{/if}
		<span class="text-xs font-medium text-cyan-400/80">{getToolLabel(msg.toolName)}</span>
		{#if toolSummary}
			<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]">{toolSummary}</span>
		{/if}
		{#if msg.role === 'tool_status'}
			{#if msg.toolStatus === 'done' && getToolElapsed(msg.content)}
				<span class="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]"
					>{getToolElapsed(msg.content)}</span
				>
			{/if}
			{#if msg.toolStatus === 'running'}
				<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cyan-400"></span>
			{:else if msg.toolError}
				<svg
					class="h-3 w-3 shrink-0 text-red-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			{:else}
				<svg
					class="h-3 w-3 shrink-0 text-emerald-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			{/if}
		{:else}
			{#if getToolElapsed(msg.content)}
				<span class="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]"
					>{getToolElapsed(msg.content)}</span
				>
			{/if}
			{#if msg.toolError}
				<svg
					class="h-3 w-3 shrink-0 text-red-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			{:else}
				<svg
					class="h-3 w-3 shrink-0 text-emerald-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			{/if}
		{/if}
	</button>
	{#if parsed?.diff}
		<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
			<div class="font-mono text-xs leading-relaxed">
				{#each parsed.diff as dl}
					<div
						class="flex {dl.type === '+'
							? 'bg-emerald-500/10'
							: dl.type === '-'
								? 'bg-red-500/10'
								: ''}"
					>
						<span class="w-8 shrink-0 pr-2 text-right text-[var(--color-text-muted)] select-none"
							>{dl.lineNum || ''}</span
						>
						<span
							class="w-4 shrink-0 select-none {dl.type === '+'
								? 'text-emerald-400'
								: dl.type === '-'
									? 'text-red-400'
									: 'text-[var(--color-text-muted)]'}">{dl.type === ' ' ? '' : dl.type}</span
						>
						<span
							class="whitespace-pre-wrap {dl.type === '+'
								? 'text-emerald-400'
								: dl.type === '-'
									? 'text-red-400'
									: 'text-[var(--color-text-muted)]'}">{dl.content}</span
						>
					</div>
				{/each}
			</div>
		</div>
	{:else if msg.role === 'tool_status'}
		{#if msg.toolError && msg.toolStatus === 'done' && msg.content}
			<div class="border-t border-red-500/10 px-2.5 py-1.5">
				<p class="text-xs text-red-400">{msg.content}</p>
			</div>
		{:else if !isExpanded && msg.toolStatus === 'done' && getToolOutputPreview(msg.toolName, msg.content)}
			<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
				<pre
					class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]">{getToolOutputPreview(
						msg.toolName,
						msg.content
					)}</pre>
			</div>
		{/if}
	{:else if msg.toolError && msg.content}
		<div class="border-t border-red-500/10 px-2.5 py-1.5">
			<p class="text-xs text-red-400">{msg.content}</p>
		</div>
	{:else if !isExpanded && getToolOutputPreview(msg.toolName, msg.content)}
		<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
			<pre
				class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]">{getToolOutputPreview(
					msg.toolName,
					msg.content
				)}</pre>
		</div>
	{/if}
	{#if isExpanded}
		<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
			{#if msg.toolArgs}
				<p class="font-mono text-xs break-all text-cyan-300/60">
					{msg.toolArgs}
				</p>
			{/if}
			{#if msg.role === 'tool_status'}
				{#if msg.toolStatus === 'done' && msg.content && !msg.toolError}
					<p
						class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
					>
						{parsed ? parsed.summary : msg.content}
					</p>
				{/if}
			{:else if !msg.toolError}
				<p
					class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
				>
					{parsed ? parsed.summary : msg.content}
				</p>
			{/if}
		</div>
	{/if}
	{#if msg.images && msg.images.length > 0}
		<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
			<div class="flex flex-wrap gap-2">
				{#each msg.images as img (img.name)}
					<a href={img.dataUrl} target="_blank" rel="noopener noreferrer">
						<img
							src={img.dataUrl}
							alt={img.name}
							class="max-h-[28rem] max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-80"
						/>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>
{#if showIframe && htmlContent}
	<div class="max-w-[90%]">
		<iframe
			sandbox="allow-scripts allow-same-origin"
			scrolling="no"
			srcdoc={buildSrcdoc(htmlContent)}
			class="w-full border-0"
			style="height: 500px; overflow: hidden;"
			onload={(e) => {
				const iframe = e.currentTarget as HTMLIFrameElement;
				const resize = () => {
					try {
						const doc = iframe.contentDocument;
						if (!doc) return;
						const hasCanvas = doc.querySelector('canvas');
						if (hasCanvas) {
							const ch = hasCanvas.offsetHeight || hasCanvas.height;
							if (ch > 50) iframe.style.height = Math.max(ch + 20, 400) + 'px';
						} else {
							const h = doc.documentElement?.scrollHeight ?? 0;
							if (h > 0) iframe.style.height = h + 'px';
						}
					} catch {}
				};
				resize();
				setTimeout(resize, 500);
				setTimeout(resize, 2000);
			}}
			title="HTML demo"
		></iframe>
	</div>
{/if}
