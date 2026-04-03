<script lang="ts">
	import type { ServerInfo, Message } from '$lib/types/chat';

	interface Props {
		project: { name: string; path: string };
		serverInfo: ServerInfo | null;
		messages: Message[];
		onexport: (format: 'md' | 'json') => void;
	}

	let { project, serverInfo, messages, onexport }: Props = $props();
</script>

<div
	class="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2"
>
	<div class="flex items-center gap-3">
		<a
			href="/projects"
			title="Back to projects"
			class="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
			</svg>
		</a>
		<span class="text-sm font-medium text-[var(--color-text-primary)]">{project.name}</span>
		<span class="font-mono text-xs text-[var(--color-text-muted)]">{project.path}</span>
	</div>
	<div class="flex items-center gap-2">
		{#if messages.length > 0}
			<div class="flex items-center gap-1">
				<button
					onclick={() => onexport('md')}
					title="Export as Markdown"
					class="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
				>
					.md
				</button>
				<button
					onclick={() => onexport('json')}
					title="Export as JSON"
					class="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
				>
					.json
				</button>
			</div>
		{/if}
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
