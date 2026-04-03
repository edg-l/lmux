<script lang="ts">
	import type { PresetInfo } from '$lib/types/chat';

	interface Props {
		temperature: number;
		top_p: number;
		top_k: number;
		min_p: number;
		repeat_penalty: number;
		samplingSource: string;
		samplingModelId: number | null;
		fetchingRecommended: boolean;
		thinkingBudgetEnabled: boolean;
		thinkingBudgetValue: number;
		presets: PresetInfo[];
		presetDropdownOpen: boolean;
		savePresetOpen: boolean;
		savePresetName: string;
		onFetchRecommended: () => void;
		onReset: () => void;
		onSave: () => void;
		onApplyPreset: (preset: PresetInfo) => void;
		onDeletePreset: (id: number) => void;
		onSaveAsPreset: () => void;
		defaultPresetId: number | null;
		onSetDefaultPreset: (presetId: number | null) => void;
	}

	let {
		temperature = $bindable(),
		top_p = $bindable(),
		top_k = $bindable(),
		min_p = $bindable(),
		repeat_penalty = $bindable(),
		samplingSource,
		samplingModelId,
		fetchingRecommended,
		thinkingBudgetEnabled = $bindable(),
		thinkingBudgetValue = $bindable(),
		presets,
		presetDropdownOpen = $bindable(),
		savePresetOpen = $bindable(),
		savePresetName = $bindable(),
		onFetchRecommended,
		onReset,
		onSave,
		onApplyPreset,
		onDeletePreset,
		onSaveAsPreset,
		defaultPresetId,
		onSetDefaultPreset
	}: Props = $props();
</script>

<div class="border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4">
	<div class="mx-auto max-w-3xl">
		<div class="mb-4 flex items-center justify-between">
			<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
				>Sampling</span
			>
			<div class="flex items-center gap-2">
				<span
					class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
					>{samplingSource}</span
				>
				<button
					onclick={onFetchRecommended}
					disabled={fetchingRecommended || !samplingModelId}
					class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
					>{fetchingRecommended ? 'Fetching...' : 'Fetch recommended'}</button
				>
				<button
					onclick={onReset}
					class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
					>Reset</button
				>
				<button
					onclick={onSave}
					class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40"
					>Save</button
				>
				<span class="mx-1 text-[var(--color-border)]">|</span>
				<div class="relative">
					<button
						onclick={() => (presetDropdownOpen = !presetDropdownOpen)}
						class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
						>Presets</button
					>
					{#if presetDropdownOpen}
						<div
							class="absolute right-0 z-20 mt-1 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] py-1 shadow-lg"
						>
							{#if presets.length === 0}
								<p class="px-3 py-2 text-xs text-[var(--color-text-muted)]">No presets</p>
							{:else}
								{#each presets as preset}
									<div
										class="group/preset flex items-center justify-between px-3 py-1.5 hover:bg-[var(--color-surface)]"
									>
										<button
											onclick={() => onApplyPreset(preset)}
											class="flex-1 text-left text-xs text-[var(--color-text-secondary)]"
											>{preset.name}</button
										>
										<div class="flex items-center gap-1">
											<button
												onclick={() =>
													onSetDefaultPreset(preset.id === defaultPresetId ? null : preset.id)}
												class="text-xs transition-colors {preset.id === defaultPresetId
													? 'text-[var(--color-accent)]'
													: 'text-[var(--color-text-muted)] opacity-0 group-hover/preset:opacity-100 hover:text-[var(--color-accent)]'}"
												title={preset.id === defaultPresetId
													? 'Unset as default'
													: 'Set as default for model'}>&#9733;</button
											>
											<button
												onclick={() => onDeletePreset(preset.id)}
												class="text-xs text-[var(--color-text-muted)] opacity-0 group-hover/preset:opacity-100 hover:text-red-400"
												>x</button
											>
										</div>
									</div>
								{/each}
							{/if}
							<div class="border-t border-[var(--color-border)] px-3 pt-1.5 pb-1">
								{#if savePresetOpen}
									<div class="flex gap-1">
										<input
											type="text"
											bind:value={savePresetName}
											placeholder="Preset name"
											onkeydown={(e) => {
												if (e.key === 'Enter') onSaveAsPreset();
											}}
											class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
										/>
										<button
											onclick={onSaveAsPreset}
											class="rounded bg-[var(--color-accent-dim)] px-2 py-0.5 text-xs text-white hover:bg-[var(--color-accent)]"
											>OK</button
										>
									</div>
								{:else}
									<button
										onclick={() => (savePresetOpen = true)}
										class="w-full text-left text-xs text-[var(--color-accent)] hover:underline"
										>Save as Preset</button
									>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
		<div class="grid grid-cols-5 gap-4">
			{#each [{ label: 'Temperature', value: temperature, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (temperature = v) }, { label: 'Top P', value: top_p, min: 0, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (top_p = v) }, { label: 'Top K', value: top_k, min: 0, max: 200, step: 1, fmt: (v: number) => String(v), set: (v: number) => (top_k = v) }, { label: 'Min P', value: min_p, min: 0, max: 1, step: 0.01, fmt: (v: number) => v.toFixed(2), set: (v: number) => (min_p = v) }, { label: 'Repeat', value: repeat_penalty, min: 0.5, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (repeat_penalty = v) }] as param}
				<div>
					<div class="mb-2 flex items-baseline justify-between">
						<span class="text-xs text-[var(--color-text-muted)]">{param.label}</span>
						<span class="font-mono text-xs font-medium text-[var(--color-text-primary)]"
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
						class="sampling-range w-full"
					/>
				</div>
			{/each}
		</div>
		<!-- Thinking Budget -->
		<div class="mt-4 border-t border-[var(--color-border)] pt-4">
			<div class="flex items-center gap-3">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						bind:checked={thinkingBudgetEnabled}
						class="accent-[var(--color-accent)]"
					/>
					<span class="text-xs text-[var(--color-text-muted)]">Thinking Budget</span>
				</label>
				{#if thinkingBudgetEnabled}
					<span class="font-mono text-xs font-medium text-[var(--color-text-primary)]"
						>{thinkingBudgetValue.toLocaleString()}</span
					>
					<input
						type="range"
						bind:value={thinkingBudgetValue}
						min={0}
						max={32768}
						step={256}
						class="sampling-range flex-1"
					/>
				{:else}
					<span class="text-xs text-[var(--color-text-muted)]">Unlimited</span>
				{/if}
			</div>
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
