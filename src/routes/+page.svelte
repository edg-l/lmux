<script lang="ts">
	import { formatBytes, formatParams } from '$lib/format';

	let { data } = $props();

	let totalVram = $derived(
		data.hardware.gpus.reduce((s: number, g: { vram_total: number }) => s + g.vram_total, 0)
	);
	let freeVram = $derived(
		data.hardware.gpus.reduce((s: number, g: { vram_free: number }) => s + g.vram_free, 0)
	);
	let vramPercent = $derived(
		totalVram > 0 ? Math.round(((totalVram - freeVram) / totalVram) * 100) : 0
	);
	let ramPercent = $derived(
		data.hardware.memory.total > 0
			? Math.round(
					((data.hardware.memory.total - data.hardware.memory.available) /
						data.hardware.memory.total) *
						100
				)
			: 0
	);

	function displayName(filename: string): string {
		return filename.replace(/\.gguf$/i, '');
	}
</script>

<div class="space-y-6">
	<!-- Hardware overview -->
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#if data.hardware.gpus.length > 0}
			{#each data.hardware.gpus as gpu}
				<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
					<p class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
						GPU
					</p>
					<p
						class="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]"
						title={gpu.name}
					>
						{gpu.name}
					</p>
					<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
						<div
							class="h-full rounded-full bg-[var(--color-accent)]"
							style="width: {vramPercent}%"
						></div>
					</div>
					<p class="mt-1.5 font-mono text-xs text-[var(--color-text-muted)]">
						{formatBytes(gpu.vram_free)} free / {formatBytes(gpu.vram_total)}
					</p>
				</div>
			{/each}
		{:else}
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
				<p class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
					GPU
				</p>
				<p class="mt-1 text-sm text-[var(--color-text-muted)]">None detected</p>
			</div>
		{/if}

		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
			<p class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
				Memory
			</p>
			<p class="mt-1 font-mono text-sm font-medium text-[var(--color-text-primary)]">
				{formatBytes(data.hardware.memory.available)} free
			</p>
			<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
				<div
					class="h-full rounded-full bg-[var(--color-accent)]"
					style="width: {ramPercent}%"
				></div>
			</div>
			<p class="mt-1.5 font-mono text-xs text-[var(--color-text-muted)]">
				/ {formatBytes(data.hardware.memory.total)}
			</p>
		</div>

		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
			<p class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">CPU</p>
			<p
				class="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]"
				title={data.hardware.cpu.model}
			>
				{data.hardware.cpu.model}
			</p>
			<p class="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
				{data.hardware.cpu.physical_cores} cores / {data.hardware.cpu.threads} threads
			</p>
		</div>

		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
			<p class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
				Models
			</p>
			<p class="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
				{data.models.length}
			</p>
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				<a href="/models" class="text-[var(--color-accent)] hover:underline">View library</a>
				&middot;
				<a href="/search" class="text-[var(--color-accent)] hover:underline">Search HF</a>
			</p>
		</div>
	</div>

	<!-- Models list -->
	{#if data.models.length > 0}
		<div>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					Local Models
				</h2>
				<a href="/models" class="text-xs text-[var(--color-accent)] hover:underline">View all</a>
			</div>
			<div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
				{#each data.models.slice(0, 10) as model, i}
					<a
						href="/models/{model.id}"
						class="flex items-center justify-between bg-[var(--color-elevated)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)] {i >
						0
							? 'border-t border-[var(--color-border)]'
							: ''}"
					>
						<div class="flex min-w-0 items-center gap-3">
							<span class="truncate font-mono text-sm text-[var(--color-text-primary)]"
								>{displayName(model.filename)}</span
							>
							<div class="flex shrink-0 gap-1.5">
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
							</div>
						</div>
						<div
							class="ml-4 flex shrink-0 items-center gap-4 font-mono text-xs text-[var(--color-text-muted)]"
						>
							{#if model.parameter_count}
								<span>{formatParams(model.parameter_count)}</span>
							{/if}
							<span>{formatBytes(model.size_bytes ?? 0)}</span>
							<span class="text-[var(--color-text-muted)]">{model.profile_count}p</span>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{:else}
		<div
			class="rounded-lg border border-dashed border-[var(--color-border)] px-8 py-12 text-center"
		>
			<p class="text-sm text-[var(--color-text-secondary)]">No models yet</p>
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				<a href="/models" class="text-[var(--color-accent)] hover:underline"
					>Scan for local models</a
				>
				or
				<a href="/search" class="text-[var(--color-accent)] hover:underline">search HuggingFace</a>
			</p>
		</div>
	{/if}
</div>
