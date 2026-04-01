<script lang="ts">
	interface GpuInfo {
		name: string;
		vendor: string;
		vram_total: number;
		vram_free: number;
		driver_version: string;
	}

	interface HardwareProfile {
		gpus: GpuInfo[];
		memory: { total: number; available: number };
		cpu: { model: string; physical_cores: number; threads: number };
		disk: { path: string; total: number; available: number };
		detected_at: string;
	}

	import { formatBytes } from '$lib/format';

	let profile: HardwareProfile | null = $state(null);
	let loading = $state(false);
	let error: string | null = $state(null);

	async function fetchProfile(refresh = false) {
		loading = true;
		error = null;
		try {
			const url = '/api/hardware';
			const opts: RequestInit = refresh ? { method: 'POST' } : {};
			const fullUrl = refresh ? `${url}?refresh=true` : url;
			const res = await fetch(fullUrl, opts);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			profile = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load hardware info';
		} finally {
			loading = false;
		}
	}

	function usagePercent(used: number, total: number): number {
		if (total <= 0) return 0;
		return Math.round(((total - used) / total) * 100);
	}

	import { onMount } from 'svelte';
	onMount(() => {
		fetchProfile();
	});
</script>

<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)]">
	<div class="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
		<h3 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
			Hardware
		</h3>
		<button
			class="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-secondary)] disabled:opacity-50"
			onclick={() => fetchProfile(true)}
			disabled={loading}
		>
			{loading ? 'Detecting...' : 'Re-detect'}
		</button>
	</div>

	<div class="p-5">
		{#if error}
			<p class="text-sm text-red-400">{error}</p>
		{:else if !profile}
			<p class="text-sm text-[var(--color-text-muted)]">Loading...</p>
		{:else}
			<div class="space-y-4">
				{#if profile.gpus.length > 0}
					{#each profile.gpus as gpu}
						<div>
							<div class="flex items-baseline justify-between">
								<span class="text-xs font-medium text-[var(--color-text-secondary)]"
									>{gpu.name}</span
								>
								<span class="font-mono text-xs text-[var(--color-text-muted)]"
									>{gpu.driver_version}</span
								>
							</div>
							<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
								<div
									class="h-full rounded-full bg-[var(--color-accent)]"
									style="width: {usagePercent(gpu.vram_free, gpu.vram_total)}%"
								></div>
							</div>
							<p class="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
								{formatBytes(gpu.vram_free)} free / {formatBytes(gpu.vram_total)}
							</p>
						</div>
					{/each}
				{:else}
					<p class="text-xs text-[var(--color-text-muted)]">No GPU detected</p>
				{/if}

				<div class="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4">
					<div>
						<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">CPU</p>
						<p class="mt-0.5 text-xs text-[var(--color-text-secondary)]">{profile.cpu.model}</p>
						<p class="font-mono text-xs text-[var(--color-text-muted)]">
							{profile.cpu.physical_cores}c / {profile.cpu.threads}t
						</p>
					</div>
					<div>
						<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Memory</p>
						<p class="mt-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
							{formatBytes(profile.memory.available)} free
						</p>
						<p class="font-mono text-xs text-[var(--color-text-muted)]">
							/ {formatBytes(profile.memory.total)}
						</p>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
