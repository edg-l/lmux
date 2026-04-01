<script lang="ts">
	let { data } = $props();

	import { formatBytes } from '$lib/format';

	let downloading = $state<Record<string, boolean>>({});
	let downloadErrors = $state<Record<string, string>>({});

	function fitColor(fit: string): string {
		switch (fit) {
			case 'fits':
				return 'bg-emerald-400';
			case 'tight':
				return 'bg-amber-400';
			default:
				return 'bg-red-400';
		}
	}

	function fitLabel(fit: string): string {
		switch (fit) {
			case 'fits':
				return 'Fits in VRAM';
			case 'tight':
				return 'Tight fit';
			default:
				return 'Exceeds VRAM';
		}
	}

	async function download(filename: string) {
		downloading[filename] = true;
		downloadErrors[filename] = '';

		try {
			const res = await fetch('/api/hf/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repoId: data.repoId, filename })
			});

			if (!res.ok) {
				const body = await res.json();
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
		} catch (e) {
			downloadErrors[filename] = e instanceof Error ? e.message : 'Download failed';
		} finally {
			downloading[filename] = false;
		}
	}
</script>

<div class="mx-auto max-w-6xl">
	<a
		href="/search"
		class="mb-6 inline-flex items-center gap-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase transition-colors hover:text-[var(--color-text-secondary)]"
	>
		<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
		</svg>
		Search
	</a>

	<h1 class="mb-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">
		{data.repoId}
	</h1>
	<p class="mb-6 font-mono text-xs text-[var(--color-text-muted)]">
		{data.files.length} GGUF file{data.files.length !== 1 ? 's' : ''}
	</p>

	{#if data.generationConfig}
		<div class="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
			<h2 class="mb-3 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
				Recommended Parameters
			</h2>
			<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
				{#if data.generationConfig.temperature != null}
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-[var(--color-text-secondary)]">Temperature</span>
						<span class="font-mono text-xs text-[var(--color-text-primary)]"
							>{data.generationConfig.temperature}</span
						>
					</div>
				{/if}
				{#if data.generationConfig.top_p != null}
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-[var(--color-text-secondary)]">Top P</span>
						<span class="font-mono text-xs text-[var(--color-text-primary)]"
							>{data.generationConfig.top_p}</span
						>
					</div>
				{/if}
				{#if data.generationConfig.top_k != null}
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-[var(--color-text-secondary)]">Top K</span>
						<span class="font-mono text-xs text-[var(--color-text-primary)]"
							>{data.generationConfig.top_k}</span
						>
					</div>
				{/if}
				{#if data.generationConfig.min_p != null}
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-[var(--color-text-secondary)]">Min P</span>
						<span class="font-mono text-xs text-[var(--color-text-primary)]"
							>{data.generationConfig.min_p}</span
						>
					</div>
				{/if}
				{#if data.generationConfig.repetition_penalty != null}
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-[var(--color-text-secondary)]">Repeat Penalty</span>
						<span class="font-mono text-xs text-[var(--color-text-primary)]"
							>{data.generationConfig.repetition_penalty}</span
						>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if data.files.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]">No GGUF files found in this repository.</p>
	{:else}
		<div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
			{#each data.files as file, i}
				<div
					class="flex items-center justify-between bg-[var(--color-elevated)] px-5 py-3.5 {i > 0
						? 'border-t border-[var(--color-border)]'
						: ''}"
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2.5">
							<span
								class="h-2 w-2 shrink-0 rounded-full {fitColor(file.fit)}"
								title={fitLabel(file.fit)}
							></span>
							<span class="truncate font-mono text-sm text-[var(--color-text-primary)]"
								>{file.filename}</span
							>
						</div>
						<div
							class="mt-1 flex items-center gap-3 pl-[18px] font-mono text-xs text-[var(--color-text-muted)]"
						>
							<span>{formatBytes(file.size)}</span>
							{#if file.quantType}
								<span
									class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-1 py-0.5 text-xs font-medium text-[var(--color-accent)]"
									>{file.quantType}</span
								>
							{/if}
							<span class="text-xs">{fitLabel(file.fit)}</span>
						</div>
						{#if downloadErrors[file.filename]}
							<p class="mt-1 pl-[18px] text-xs text-red-400">{downloadErrors[file.filename]}</p>
						{/if}
					</div>
					<button
						onclick={() => download(file.filename)}
						disabled={downloading[file.filename]}
						class="ml-4 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)] disabled:opacity-50"
					>
						{downloading[file.filename] ? 'Starting...' : 'Download'}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
