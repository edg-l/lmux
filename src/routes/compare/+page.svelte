<script lang="ts">
	import { onMount } from 'svelte';
	import ComparePane from '$lib/components/ComparePane.svelte';
	import type { Conversation } from '$lib/types/chat';

	let conversations = $state<Conversation[]>([]);
	let leftId: number | null = $state(null);
	let rightId: number | null = $state(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/conversations');
			if (res.ok) {
				conversations = await res.json();
			}
		} catch {
			// ignore
		}
	});
</script>

<div class="-m-5 flex h-screen flex-col md:-m-8">
	<div
		class="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
	>
		<h1 class="text-sm font-semibold text-[var(--color-text-primary)]">Compare</h1>
	</div>

	<div class="flex flex-1 overflow-hidden">
		<!-- Left pane -->
		<div class="flex flex-1 flex-col border-r border-[var(--color-border)]">
			<div class="border-b border-[var(--color-border)] px-4 py-2">
				<select
					bind:value={leftId}
					class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
				>
					<option value={null}>Select conversation...</option>
					{#each conversations as conv (conv.id)}
						<option value={conv.id}>
							{conv.title || 'Untitled'}{conv.model_name ? ` (${conv.model_name})` : ''}
						</option>
					{/each}
				</select>
			</div>
			<ComparePane conversationId={leftId} />
		</div>

		<!-- Right pane -->
		<div class="flex flex-1 flex-col">
			<div class="border-b border-[var(--color-border)] px-4 py-2">
				<select
					bind:value={rightId}
					class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
				>
					<option value={null}>Select conversation...</option>
					{#each conversations as conv (conv.id)}
						<option value={conv.id}>
							{conv.title || 'Untitled'}{conv.model_name ? ` (${conv.model_name})` : ''}
						</option>
					{/each}
				</select>
			</div>
			<ComparePane conversationId={rightId} />
		</div>
	</div>
</div>
