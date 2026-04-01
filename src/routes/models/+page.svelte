<script lang="ts">
	let { data } = $props();

	import { formatBytes, formatParams } from '$lib/format';

	let localModels: typeof data.models | null = $state(null);
	let models = $derived(localModels ?? data.models);
	let scanning = $state(false);
	let deleteConfirm: number | null = $state(null);

	async function scan() {
		scanning = true;
		try {
			const res = await fetch('/api/models?scan=force');
			if (res.ok) {
				const body = await res.json();
				localModels = body.models;
			}
		} finally {
			scanning = false;
		}
	}

	async function deleteModel(id: number) {
		const res = await fetch(`/api/models/${id}`, { method: 'DELETE' });
		if (res.ok) {
			localModels = models.filter((m) => m.id !== id);
		}
		deleteConfirm = null;
	}

	function displayName(filename: string): string {
		return filename.replace(/\.gguf$/i, '');
	}
</script>

<div>
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-sm font-semibold text-[var(--color-text-primary)]">Models</h1>
		<button
			onclick={scan}
			disabled={scanning}
			class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
		>
			{scanning ? 'Scanning...' : 'Scan Models'}
		</button>
	</div>

	{#if models.length === 0}
		<div
			class="rounded-lg border border-dashed border-[var(--color-border)] px-8 py-16 text-center"
		>
			<p class="text-sm text-[var(--color-text-secondary)]">No models found</p>
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				Scan to detect local GGUF files, or <a
					href="/search"
					class="text-[var(--color-accent)] hover:underline">search HuggingFace</a
				> to download.
			</p>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each models as model}
				<div
					class="group rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] transition-colors hover:border-[var(--color-border-active)]"
				>
					<a href="/models/{model.id}" class="block p-4">
						<h3
							class="truncate font-mono text-sm font-medium text-[var(--color-text-primary)]"
							title={model.filename}
						>
							{displayName(model.filename)}
						</h3>
						<div class="mt-2.5 flex flex-wrap gap-1.5">
							{#if model.quant_type}
								<span
									class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-1.5 py-0.5 font-mono text-xs font-medium text-[var(--color-accent)]"
									>{model.quant_type}</span
								>
							{/if}
							{#if model.architecture}
								<span
									class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
									>{model.architecture}</span
								>
							{/if}
							{#if model.parameter_count}
								<span
									class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
									>{formatParams(model.parameter_count)}</span
								>
							{/if}
						</div>
						<p class="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
							{formatBytes(model.size_bytes ?? 0)}
						</p>
					</a>
					<div
						class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2"
					>
						<span class="text-xs text-[var(--color-text-muted)]">
							{model.profile_count} profile{model.profile_count !== 1 ? 's' : ''}
						</span>
						{#if deleteConfirm === model.id}
							<div class="flex gap-2">
								<button
									onclick={() => deleteModel(model.id)}
									class="text-xs font-medium text-red-400 hover:text-red-300">Confirm</button
								>
								<button
									onclick={() => (deleteConfirm = null)}
									class="text-xs text-[var(--color-text-muted)]">Cancel</button
								>
							</div>
						{:else}
							<button
								onclick={() => (deleteConfirm = model.id)}
								class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
							>
								Delete
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
