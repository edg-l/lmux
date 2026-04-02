<script lang="ts">
	interface Props {
		modelSystemPrompt: string | null;
		samplingModelId: number | null;
	}

	let { modelSystemPrompt = $bindable(), samplingModelId }: Props = $props();

	async function resetToGlobal() {
		if (!samplingModelId) return;
		await fetch(`/api/models/${samplingModelId}/system-prompt`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ system_prompt: null })
		});
		modelSystemPrompt = null;
	}

	async function saveSystemPrompt() {
		if (!samplingModelId) return;
		await fetch(`/api/models/${samplingModelId}/system-prompt`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ system_prompt: modelSystemPrompt })
		});
	}
</script>

<div class="border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4">
	<div class="mx-auto max-w-3xl">
		<div class="mb-3 flex items-center justify-between">
			<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
				>System Prompt</span
			>
			<div class="flex items-center gap-2">
				<button
					onclick={resetToGlobal}
					disabled={!samplingModelId}
					class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
					>Reset to global</button
				>
				<button
					onclick={saveSystemPrompt}
					disabled={!samplingModelId}
					class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40 disabled:opacity-50"
					>Save</button
				>
			</div>
		</div>
		<textarea
			bind:value={modelSystemPrompt}
			rows={4}
			placeholder="Leave empty to use global default"
			class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
		></textarea>
	</div>
</div>
