<script lang="ts">
	import { onMount } from 'svelte';

	interface Conversation {
		id: number;
		title: string | null;
		model_name: string | null;
		created_at: string;
		updated_at: string;
	}

	interface Props {
		projectId: number;
		activeConversationId: number | null;
		modelId: number | null;
		onSelect: (id: number) => void;
		onNew: () => void;
		onDelete?: (id: number) => void;
	}

	let { projectId, activeConversationId, modelId, onSelect, onNew, onDelete }: Props = $props();

	let conversations = $state<Conversation[]>([]);

	onMount(() => {
		loadConversations();
	});

	export async function loadConversations() {
		try {
			const res = await fetch(`/api/projects/${projectId}/conversations`);
			if (res.ok) conversations = await res.json();
		} catch {
			// ignore
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
</script>

<div class="flex min-h-0 flex-col">
	<div class="mb-1 px-2 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
		Sessions
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#each conversations as conv (conv.id)}
			<div
				class="group flex items-center rounded transition-colors
					{activeConversationId === conv.id
					? 'border-l-2 border-l-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
					: 'border-l-2 border-l-transparent hover:bg-[var(--color-surface-hover)]'}"
			>
				<button
					onclick={() => onSelect(conv.id)}
					class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left
						{activeConversationId === conv.id
						? 'text-[var(--color-text-primary)]'
						: 'text-[var(--color-text-secondary)]'}"
				>
					<span class="min-w-0 flex-1 truncate text-xs">
						{conv.title || 'New Chat'}
					</span>
					<span class="shrink-0 text-xs text-[var(--color-text-muted)]">
						{formatTime(conv.updated_at)}
					</span>
				</button>
				{#if onDelete}
					<button
						onclick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
						class="shrink-0 px-1.5 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
						title="Delete session"
					>
						<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>
		{/each}
		{#if conversations.length === 0}
			<p class="px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">No sessions</p>
		{/if}
	</div>
	<button
		onclick={onNew}
		class="mt-1 flex w-full shrink-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-subtle)]"
	>
		<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
		</svg>
		New Chat
	</button>
</div>
