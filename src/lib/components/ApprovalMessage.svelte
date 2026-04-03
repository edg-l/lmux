<script lang="ts">
	import type { Message } from '$lib/types/chat';
	import { highlightDangers } from '$lib/utils/chat';

	interface Props {
		msg: Message;
		onapproval: (requestId: string, approved: boolean, remember?: boolean) => void;
	}

	let { msg, onapproval }: Props = $props();
</script>

{#if msg.approval}
	{@const approval = msg.approval}
	<div
		class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)]
			{approval.resolved
			? approval.approved
				? 'border-l-emerald-500/60'
				: 'border-l-red-500/60'
			: 'border-l-amber-500/60'}"
	>
		<div class="px-3 py-2">
			{#if !approval.sandboxed}
				<div class="mb-2 flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-1">
					<svg
						class="h-3.5 w-3.5 shrink-0 text-red-400"
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
					<span class="text-xs font-medium text-red-400">Unsandboxed</span>
				</div>
			{/if}
			{#if approval.resolved}
				<div class="text-xs font-medium {approval.approved ? 'text-emerald-400' : 'text-red-400'}">
					{approval.approved ? 'Approved' : 'Denied'}
				</div>
			{:else}
				<div class="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
					Command approval required:
				</div>
				<pre
					class="mb-2 overflow-x-auto rounded bg-[var(--color-surface)] p-2 font-mono text-xs text-[var(--color-text-primary)]">{@html highlightDangers(
						approval.command,
						approval.dangers
					)}</pre>
				<div class="flex items-center gap-2">
					<button
						onclick={() => onapproval(approval.requestId, true)}
						class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
					>
						Approve
					</button>
					<button
						onclick={() => onapproval(approval.requestId, true, true)}
						class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
					>
						Always Allow
					</button>
					<button
						onclick={() => onapproval(approval.requestId, false)}
						class="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
					>
						Deny
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
