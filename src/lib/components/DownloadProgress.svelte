<script lang="ts">
	interface DownloadInfo {
		filename: string;
		totalBytes: number;
		downloadedBytes: number;
		speed: number;
		status: 'downloading' | 'completed' | 'cancelled' | 'error';
		error?: string;
	}

	import { formatBytes } from '$lib/format';

	let downloads = $state<Record<string, DownloadInfo>>({});
	let expanded = $state(true);
	let connected = $state(false);

	function formatSpeed(bytesPerSec: number): string {
		return formatBytes(bytesPerSec) + '/s';
	}

	function formatEta(downloaded: number, total: number, speed: number): string {
		if (speed <= 0 || total <= 0) return '--';
		const remaining = total - downloaded;
		const seconds = remaining / speed;
		if (seconds < 60) return Math.ceil(seconds) + 's';
		if (seconds < 3600) return Math.ceil(seconds / 60) + 'm';
		return (seconds / 3600).toFixed(1) + 'h';
	}

	function percentage(downloaded: number, total: number): number {
		if (total <= 0) return 0;
		return Math.min(100, (downloaded / total) * 100);
	}

	$effect(() => {
		const eventSource = new EventSource('/api/hf/download/progress');
		eventSource.onopen = () => {
			connected = true;
		};
		eventSource.onmessage = (event) => {
			try {
				downloads = JSON.parse(event.data);
			} catch {
				/* ignore */
			}
		};
		eventSource.onerror = () => {
			connected = false;
		};
		return () => eventSource.close();
	});

	async function cancel(id: string) {
		await fetch(`/api/hf/download?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
	}

	let activeEntries = $derived(
		Object.entries(downloads).filter(([, d]) => d.status === 'downloading')
	);
	let hasActive = $derived(activeEntries.length > 0);
	let allEntries = $derived(Object.entries(downloads));
</script>

{#if allEntries.length > 0}
	<div
		class="fixed right-4 bottom-4 z-50 w-80 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-2xl shadow-black/40"
	>
		<button
			class="flex w-full items-center justify-between px-4 py-2.5"
			onclick={() => (expanded = !expanded)}
		>
			<span class="flex items-center gap-2 text-xs font-medium text-[var(--color-text-primary)]">
				{#if hasActive}
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]"></span>
				{/if}
				Downloads
				{#if hasActive}
					<span class="font-mono text-[var(--color-text-muted)]">({activeEntries.length})</span>
				{/if}
			</span>
			<svg
				class="h-3.5 w-3.5 text-[var(--color-text-muted)] transition-transform {expanded
					? ''
					: 'rotate-180'}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="2"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
			</svg>
		</button>

		{#if expanded}
			<div class="max-h-64 overflow-y-auto border-t border-[var(--color-border)] p-2">
				{#each allEntries as [id, dl]}
					<div
						class="rounded-md bg-[var(--color-surface)] p-3 {allEntries.indexOf([id, dl]) > 0
							? 'mt-1.5'
							: ''}"
					>
						<div class="mb-1.5 flex items-center justify-between">
							<span
								class="truncate font-mono text-xs text-[var(--color-text-secondary)]"
								title={dl.filename}>{dl.filename}</span
							>
							{#if dl.status === 'downloading'}
								<button
									onclick={() => cancel(id)}
									class="ml-2 shrink-0 text-xs text-[var(--color-text-muted)] hover:text-red-400"
									>Cancel</button
								>
							{/if}
						</div>

						{#if dl.status === 'downloading'}
							<div class="mb-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-border)]">
								<div
									class="h-full rounded-full bg-[var(--color-accent)] transition-all"
									style="width: {percentage(dl.downloadedBytes, dl.totalBytes)}%"
								></div>
							</div>
							<div class="flex justify-between font-mono text-xs text-[var(--color-text-muted)]">
								<span>{percentage(dl.downloadedBytes, dl.totalBytes).toFixed(0)}%</span>
								<span
									>{formatSpeed(dl.speed)}
									{formatEta(dl.downloadedBytes, dl.totalBytes, dl.speed)}</span
								>
							</div>
						{:else if dl.status === 'completed'}
							<p class="text-xs text-emerald-400">Complete</p>
						{:else if dl.status === 'cancelled'}
							<p class="text-xs text-amber-400">Cancelled</p>
						{:else if dl.status === 'error'}
							<p class="text-xs text-red-400">{dl.error ?? 'Failed'}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
