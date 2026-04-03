<script lang="ts">
	import type { ServerInfo } from '$lib/types/chat';

	interface Props {
		planEnabled: boolean;
		memoryEnabled: boolean;
		thinkingBudgetEnabled: boolean;
		thinkingBudgetValue: number;
		temperature: number;
		topP: number;
		topK: number;
		minP: number;
		repeatPenalty: number;
		runningProcesses: Array<{ id: string; command: string; startedAt: string; running: boolean }>;
		fetchingRecommended: boolean;
		serverInfo: ServerInfo | null;
		onfetchrecommended: () => void;
		onresetsampling: () => void;
		onkillprocess: (id: string) => void;
	}

	let {
		planEnabled = $bindable(),
		memoryEnabled = $bindable(),
		thinkingBudgetEnabled = $bindable(),
		thinkingBudgetValue = $bindable(),
		temperature = $bindable(),
		topP = $bindable(),
		topK = $bindable(),
		minP = $bindable(),
		repeatPenalty = $bindable(),
		runningProcesses,
		fetchingRecommended,
		serverInfo,
		onfetchrecommended,
		onresetsampling,
		onkillprocess
	}: Props = $props();
</script>

<div
	class="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-elevated)] xl:flex"
>
	<!-- Plan toggle -->
	<div class="border-b border-[var(--color-border)] px-3 py-3">
		<button
			onclick={() => (planEnabled = !planEnabled)}
			class="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-medium transition-colors {planEnabled
				? 'bg-[var(--color-accent-subtle,var(--color-surface))] text-[var(--color-accent)]'
				: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]'}"
		>
			<span class="flex items-center gap-1.5">
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
						d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
					/>
				</svg>
				Plan
			</span>
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-medium {planEnabled
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'}"
			>
				{planEnabled ? 'ON' : 'OFF'}
			</span>
		</button>
	</div>

	<!-- Memory toggle -->
	<div class="border-b border-[var(--color-border)] px-3 py-3">
		<button
			onclick={() => (memoryEnabled = !memoryEnabled)}
			class="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-medium transition-colors {memoryEnabled
				? 'bg-[var(--color-accent-subtle,var(--color-surface))] text-[var(--color-accent)]'
				: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]'}"
		>
			<span class="flex items-center gap-1.5">
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
						d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
					/>
				</svg>
				Memory
			</span>
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-medium {memoryEnabled
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'}"
			>
				{memoryEnabled ? 'ON' : 'OFF'}
			</span>
		</button>
	</div>

	<!-- Reasoning budget -->
	<div class="border-b border-[var(--color-border)] px-3 py-3">
		<button
			onclick={() => (thinkingBudgetEnabled = !thinkingBudgetEnabled)}
			class="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-medium transition-colors {thinkingBudgetEnabled
				? 'bg-[var(--color-accent-subtle,var(--color-surface))] text-[var(--color-accent)]'
				: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]'}"
		>
			<span class="flex items-center gap-1.5">
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
						d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
					/>
				</svg>
				Reasoning
			</span>
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-medium {thinkingBudgetEnabled
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'}"
			>
				{thinkingBudgetEnabled ? 'ON' : 'OFF'}
			</span>
		</button>
		{#if thinkingBudgetEnabled}
			<div class="mt-2 px-2">
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-[var(--color-text-muted)]">Budget</span>
					<span class="font-mono text-xs text-[var(--color-text-primary)]">
						{thinkingBudgetValue.toLocaleString()}
					</span>
				</div>
				<input
					type="range"
					bind:value={thinkingBudgetValue}
					min={1024}
					max={32768}
					step={256}
					class="sampling-range mt-1 w-full"
				/>
			</div>
		{/if}
	</div>

	<!-- Processes -->
	{#if runningProcesses.length > 0}
		<div class="border-b border-[var(--color-border)] px-3 py-3">
			<span
				class="mb-2 block text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
				>Processes</span
			>
			{#each runningProcesses as proc}
				<div class="mb-1 flex items-center justify-between rounded px-2 py-1 text-xs">
					<span class="flex items-center gap-1.5 truncate text-[var(--color-text-secondary)]">
						<span
							class="h-1.5 w-1.5 rounded-full {proc.running
								? 'bg-emerald-400'
								: 'bg-[var(--color-text-muted)]'}"
						></span>
						<span class="truncate" title={proc.command}
							>{proc.command.length > 20 ? proc.command.slice(0, 20) + '...' : proc.command}</span
						>
					</span>
					<button
						onclick={() => onkillprocess(proc.id)}
						class="shrink-0 text-[var(--color-text-muted)] hover:text-red-400"
						title="Stop process"
					>
						&#x2715;
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Sampling parameters -->
	<div class="px-3 py-3">
		<span
			class="mb-3 block text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
			>Sampling</span
		>
		{#each [{ label: 'Temp', value: temperature, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (temperature = v) }, { label: 'Top-P', value: topP, min: 0, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (topP = v) }, { label: 'Top-K', value: topK, min: 0, max: 200, step: 1, fmt: (v: number) => String(v), set: (v: number) => (topK = v) }, { label: 'Min-P', value: minP, min: 0, max: 1, step: 0.01, fmt: (v: number) => v.toFixed(2), set: (v: number) => (minP = v) }, { label: 'Rep.Pen', value: repeatPenalty, min: 1, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (repeatPenalty = v) }] as param}
			<div class="mb-2">
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-[var(--color-text-muted)]">{param.label}</span>
					<span class="font-mono text-xs text-[var(--color-text-primary)]"
						>{param.fmt(param.value)}</span
					>
				</div>
				<input
					type="range"
					value={param.value}
					oninput={(e) => param.set(parseFloat(e.currentTarget.value))}
					min={param.min}
					max={param.max}
					step={param.step}
					class="sampling-range mt-1 w-full"
				/>
			</div>
		{/each}
		<div class="mt-2 flex gap-1">
			<button
				onclick={onfetchrecommended}
				disabled={fetchingRecommended || !serverInfo?.modelId}
				class="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)] disabled:opacity-50"
			>
				{fetchingRecommended ? 'Fetching...' : 'Fetch recommended'}
			</button>
			<button
				onclick={onresetsampling}
				class="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
			>
				Reset
			</button>
		</div>
	</div>
</div>

<style>
	.sampling-range {
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface);
		outline: none;
	}
	.sampling-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		cursor: pointer;
	}
	.sampling-range::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		cursor: pointer;
		border: none;
	}
	.sampling-range::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface);
	}
</style>
