<script lang="ts">
	interface ServerState {
		status: 'stopped' | 'starting' | 'ready' | 'error';
		modelId: number | null;
		modelName: string | null;
		port: number;
		pid: number | null;
		startedAt: string | null;
		error: string | null;
		stderr: string[];
		lastTokensPerSecond: number | null;
	}

	const defaultState: ServerState = {
		status: 'stopped',
		modelId: null,
		modelName: null,
		port: 8080,
		pid: null,
		startedAt: null,
		error: null,
		stderr: [],
		lastTokensPerSecond: null
	};

	let serverInfo: ServerState = $state(defaultState);
	let stopping = $state(false);
	let showStderr = $state(false);
	let fullscreenLogs = $state(false);

	let statusColor = $derived(
		serverInfo.status === 'ready'
			? 'bg-emerald-400'
			: serverInfo.status === 'starting'
				? 'bg-amber-400 animate-pulse'
				: serverInfo.status === 'error'
					? 'bg-red-400'
					: 'bg-[var(--color-text-muted)]'
	);

	let statusLabel = $derived(
		serverInfo.status === 'ready'
			? 'Running'
			: serverInfo.status === 'starting'
				? 'Starting'
				: serverInfo.status === 'error'
					? 'Error'
					: 'Stopped'
	);

	let isActive = $derived(serverInfo.status !== 'stopped');

	$effect(() => {
		const eventSource = new EventSource('/api/server/status');
		eventSource.onmessage = (event) => {
			try {
				serverInfo = JSON.parse(event.data);
				if (serverInfo.status === 'stopped') stopping = false;
			} catch {
				/* ignore */
			}
		};
		return () => eventSource.close();
	});

	async function stop() {
		stopping = true;
		try {
			await fetch('/api/server/stop', { method: 'POST' });
		} catch {
			stopping = false;
		}
	}

	/** Svelte action: portals the node to document.body */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) node.parentNode.removeChild(node);
			}
		};
	}
</script>

<div class="border-t border-[var(--color-border)] px-3 py-3">
	<div class="flex items-center gap-2">
		<span class="h-1.5 w-1.5 rounded-full {statusColor}"></span>
		<span class="text-xs font-medium text-[var(--color-text-muted)]">{statusLabel}</span>
	</div>

	{#if isActive}
		{#if serverInfo.modelName}
			<p
				class="mt-1 truncate font-mono text-xs text-[var(--color-text-secondary)]"
				title={serverInfo.modelName}
			>
				{serverInfo.modelName}
			</p>
		{/if}

		<div class="mt-1 flex flex-wrap gap-x-2.5 font-mono text-xs text-[var(--color-text-muted)]">
			<span>:{serverInfo.port}</span>
			{#if serverInfo.lastTokensPerSecond != null}
				<span class="text-[var(--color-accent)]"
					>{serverInfo.lastTokensPerSecond.toFixed(1)} t/s</span
				>
			{/if}
		</div>

		{#if serverInfo.status === 'error' && serverInfo.error}
			<p class="mt-1 text-xs text-red-400">{serverInfo.error}</p>
		{/if}

		<div class="mt-2 flex gap-1.5">
			<button
				onclick={stop}
				disabled={stopping}
				class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
			>
				{stopping ? 'Stopping...' : 'Stop'}
			</button>
			{#if serverInfo.stderr.length > 0}
				<button
					onclick={() => (showStderr = !showStderr)}
					class="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
				>
					{showStderr ? 'Hide' : 'Logs'}
				</button>
			{/if}
		</div>

		{#if showStderr && serverInfo.stderr.length > 0}
			<div class="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-base)]">
				<div
					class="flex items-center justify-between border-b border-[var(--color-border)] px-2 py-1"
				>
					<span class="text-xs text-[var(--color-text-muted)]"
						>{serverInfo.stderr.length} lines</span
					>
					<button
						onclick={() => (fullscreenLogs = true)}
						class="rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
						title="Expand"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15"
							/>
						</svg>
					</button>
				</div>
				<div
					class="max-h-32 overflow-y-auto p-2 font-mono text-xs leading-relaxed text-[var(--color-text-muted)]"
				>
					{#each serverInfo.stderr.slice(-30) as line}
						<div class="break-all whitespace-pre-wrap">{line}</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Fullscreen log modal - portaled to body to escape sidebar transform -->
{#if fullscreenLogs}
	<div use:portal>
		<div
			class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
		>
			<div
				class="flex h-[85vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-base)] shadow-2xl"
			>
				<div
					class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-5 py-3"
				>
					<div class="flex items-center gap-3">
						<h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Server Logs</h2>
						{#if serverInfo.modelName}
							<span class="font-mono text-xs text-[var(--color-text-muted)]"
								>{serverInfo.modelName}</span
							>
						{/if}
						<span
							class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
						>
							{serverInfo.stderr.length} lines
						</span>
					</div>
					<button
						onclick={() => (fullscreenLogs = false)}
						aria-label="Close logs"
						class="rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
					>
						<svg
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div
					class="flex-1 overflow-y-auto p-4 font-mono text-sm leading-6 text-[var(--color-text-secondary)]"
				>
					{#each serverInfo.stderr as line, i}
						<div class="flex hover:bg-[var(--color-surface)]">
							<span class="mr-4 w-10 shrink-0 text-right text-[var(--color-text-muted)] select-none"
								>{i + 1}</span
							>
							<span class="break-all whitespace-pre-wrap">{line}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}
