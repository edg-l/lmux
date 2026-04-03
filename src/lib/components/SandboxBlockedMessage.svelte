<script lang="ts">
	import type { Message } from '$lib/types/chat';

	interface Props {
		msg: Message;
		onallowpath: (abs: string, display: string, reqId?: string) => void;
		ondismiss: (reqId: string) => void;
	}

	let { msg, onallowpath, ondismiss }: Props = $props();
</script>

{#if msg.sandboxBlocked}
	{@const sb = msg.sandboxBlocked}
	<div
		class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)]
			{sb.resolved ? 'border-l-emerald-500/60' : 'border-l-amber-500/60'}"
	>
		<div class="px-3 py-2">
			<div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400">
				<svg
					class="h-3.5 w-3.5 shrink-0"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
					/>
				</svg>
				Sandbox blocked writes to:
			</div>
			{#each sb.paths as displayPath, i}
				<div class="mb-1 font-mono text-xs text-[var(--color-text-primary)]">
					{displayPath}
				</div>
				{#if !sb.resolved}
					<div class="mb-2 flex items-center gap-2">
						<button
							onclick={() => onallowpath(sb.absolutePaths[i], displayPath, sb.requestId)}
							class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
						>
							Allow {displayPath}
						</button>
						{#if sb.requestId}
							<button
								onclick={() => ondismiss(sb.requestId ?? '')}
								class="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
							>
								Deny
							</button>
						{/if}
					</div>
				{/if}
			{/each}
			{#if sb.resolved}
				<span class="text-xs font-medium text-emerald-400">
					Path allowed. Command will be re-run automatically.
				</span>
			{/if}
		</div>
	</div>
{/if}
