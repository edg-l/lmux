<script lang="ts">
	interface HfSearchResult {
		id: string;
		author: string;
		downloads: number;
		likes: number;
		trendingScore: number;
		lastModified: string;
		createdAt: string;
		pipelineTag: string | null;
		gated: boolean;
		tags: string[];
		license: string | null;
		baseModel: string | null;
		languages: string[];
		fileCount: number;
	}

	let { data } = $props();

	let query = $state('');
	let results: HfSearchResult[] = $state([]);
	let loading = $state(false);
	let error: string | null = $state(null);
	let searched = $state(false);

	function formatNumber(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return String(n);
	}

	function timeAgo(iso: string): string {
		if (!iso) return '';
		const ms = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(ms / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return `${Math.floor(days / 30)}mo ago`;
	}

	async function search() {
		const q = query.trim();
		if (!q) return;
		loading = true;
		error = null;
		searched = true;
		try {
			const res = await fetch(`/api/hf/search?q=${encodeURIComponent(q)}`);
			if (!res.ok) {
				const body = await res.json();
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
			results = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Search failed';
			results = [];
		} finally {
			loading = false;
		}
	}

	function clearSearch() {
		query = '';
		results = [];
		searched = false;
		error = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') search();
	}

	// Extract a display-friendly model name from the repo ID
	function modelName(id: string): string {
		return id.split('/').pop() ?? id;
	}
</script>

{#snippet modelCard(result: HfSearchResult)}
	<a
		href="/search/{result.id}"
		class="group block rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4 transition-colors hover:border-[var(--color-border-active)]"
	>
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0 flex-1">
				<h3
					class="truncate font-mono text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]"
					title={result.id}
				>
					{modelName(result.id)}
				</h3>
				<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">{result.author}</p>
			</div>
			{#if result.gated}
				<span
					class="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400"
					>Gated</span
				>
			{/if}
		</div>

		<!-- Tags -->
		<div class="mt-2.5 flex flex-wrap gap-1">
			{#if result.license}
				<span
					class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
					>{result.license}</span
				>
			{/if}
			{#if result.pipelineTag}
				<span
					class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]"
					>{result.pipelineTag}</span
				>
			{/if}
			{#if result.baseModel}
				<span
					class="max-w-40 truncate rounded border border-[var(--color-accent)]/15 bg-[var(--color-accent-subtle)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]"
					title={result.baseModel}>{result.baseModel.split('/').pop()}</span
				>
			{/if}
			{#each result.tags.slice(0, 4) as tag}
				<span
					class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]"
					>{tag}</span
				>
			{/each}
			{#if result.languages.length > 0}
				<span
					class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]"
					>{result.languages.join(', ')}</span
				>
			{/if}
		</div>

		<!-- Stats row -->
		<div class="mt-3 flex items-center gap-4 font-mono text-xs text-[var(--color-text-muted)]">
			<span title="Downloads">{formatNumber(result.downloads)} downloads</span>
			<span title="Likes">{formatNumber(result.likes)} likes</span>
			{#if result.trendingScore > 0}
				<span title="Trending score" class="text-[var(--color-accent)]"
					>{result.trendingScore} trending</span
				>
			{/if}
			{#if result.fileCount > 0}
				<span>{result.fileCount} files</span>
			{/if}
			{#if result.lastModified}
				<span>{timeAgo(result.lastModified)}</span>
			{/if}
		</div>
	</a>
{/snippet}

<div class="mx-auto max-w-6xl">
	<h1 class="mb-5 text-sm font-semibold text-[var(--color-text-primary)]">Search HuggingFace</h1>

	<div class="mb-6 flex gap-2">
		<div class="relative flex-1">
			<svg
				class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				type="text"
				bind:value={query}
				onkeydown={handleKeydown}
				placeholder="Search for GGUF models..."
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] py-2.5 pr-3 pl-9 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none"
			/>
		</div>
		{#if searched}
			<button
				onclick={clearSearch}
				class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)]"
			>
				Clear
			</button>
		{/if}
		<button
			onclick={search}
			disabled={loading || !query.trim()}
			class="rounded-lg bg-[var(--color-accent-dim)] px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
		>
			{loading ? 'Searching...' : 'Search'}
		</button>
	</div>

	{#if error}
		<div
			class="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
		>
			{error}
		</div>
	{/if}

	{#if searched}
		{#if results.length > 0}
			<p class="mb-3 text-xs text-[var(--color-text-muted)]">{results.length} results</p>
			<div class="space-y-2">
				{#each results as result}
					{@render modelCard(result)}
				{/each}
			</div>
		{:else if !loading && !error}
			<p class="text-sm text-[var(--color-text-muted)]">No results found.</p>
		{/if}
	{:else if data.trending && data.trending.length > 0}
		<h2 class="mb-3 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
			Trending GGUF Models
		</h2>
		<div class="space-y-2">
			{#each data.trending as result}
				{@render modelCard(result)}
			{/each}
		</div>
	{/if}
</div>
