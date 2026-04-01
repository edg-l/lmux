<script lang="ts">
	interface Entry {
		name: string;
		type: 'file' | 'directory';
	}

	interface Props {
		projectId: number;
		entries: Entry[];
		changedFiles: Map<string, 'created' | 'modified'>;
		onFileSelect: (path: string) => void;
	}

	let { projectId, entries, changedFiles, onFileSelect }: Props = $props();

	let expanded = $state<Set<string>>(new Set());
	let children = $state<Map<string, Entry[]>>(new Map());
	let loading = $state<Set<string>>(new Set());

	async function toggleDir(path: string) {
		const next = new Set(expanded);
		if (next.has(path)) {
			next.delete(path);
			expanded = next;
			return;
		}
		next.add(path);
		expanded = next;

		if (!children.has(path)) {
			const loadSet = new Set(loading);
			loadSet.add(path);
			loading = loadSet;
			try {
				const res = await fetch(
					`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`
				);
				if (res.ok) {
					const data = await res.json();
					const newChildren = new Map(children);
					newChildren.set(path, data.entries);
					children = newChildren;
				}
			} catch {
				// ignore
			} finally {
				const doneSet = new Set(loading);
				doneSet.delete(path);
				loading = doneSet;
			}
		}
	}

	function getChangeStatus(path: string): 'created' | 'modified' | null {
		return changedFiles.get(path) ?? null;
	}
</script>

{#snippet renderEntries(entryList: Entry[], parentPath: string, depth: number)}
	{#each entryList as entry (parentPath + '/' + entry.name)}
		{@const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name}
		{@const isExpanded = expanded.has(fullPath)}
		{@const isLoading = loading.has(fullPath)}
		{@const changeStatus = getChangeStatus(fullPath)}
		<div>
			{#if entry.type === 'directory'}
				<button
					onclick={() => toggleDir(fullPath)}
					class="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--color-surface-hover)]"
					style="padding-left: {depth * 12 + 4}px"
				>
					<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
						{isExpanded ? '▼' : '▶'}
					</span>
					<span class="truncate font-mono text-xs text-[var(--color-text-secondary)]">
						{entry.name}
					</span>
					{#if isLoading}
						<span
							class="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]"
						></span>
					{/if}
				</button>
				{#if isExpanded && children.has(fullPath)}
					{@render renderEntries(children.get(fullPath) ?? [], fullPath, depth + 1)}
				{/if}
			{:else}
				<button
					onclick={() => onFileSelect(fullPath)}
					class="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--color-surface-hover)]"
					style="padding-left: {depth * 12 + 4}px"
				>
					<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
						&nbsp;&nbsp;
					</span>
					<span class="truncate font-mono text-xs text-[var(--color-text-secondary)]">
						{entry.name}
					</span>
					{#if changeStatus === 'created'}
						<span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Created"
						></span>
					{:else if changeStatus === 'modified'}
						<span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Modified"
						></span>
					{/if}
				</button>
			{/if}
		</div>
	{/each}
{/snippet}

<div class="overflow-x-hidden overflow-y-auto">
	{@render renderEntries(entries, '', 0)}
	{#if entries.length === 0}
		<p class="px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">No files</p>
	{/if}
</div>
