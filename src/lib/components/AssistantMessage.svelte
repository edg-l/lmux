<script lang="ts">
	import type { Message } from '$lib/types/chat';
	import { renderMarkdown } from '$lib/markdown';
	import { parseThinking } from '$lib/utils/chat';

	interface Props {
		msg: Message;
		isWaiting: boolean;
		isLastMessage: boolean;
		streaming: boolean;
		collapsibleThinking: boolean;
		isPlanExpanded: boolean;
		thinkingExpandedKeys: Set<number>;
		messageIdx: number;
		ontogglethinking: (key: number) => void;
		ontoggleplan: () => void;
	}

	let {
		msg,
		isWaiting,
		isLastMessage,
		streaming,
		collapsibleThinking,
		isPlanExpanded,
		thinkingExpandedKeys,
		messageIdx,
		ontogglethinking,
		ontoggleplan
	}: Props = $props();

	let segments = $derived(parseThinking(msg.content || (isWaiting ? '...' : '')));
</script>

<div class="max-w-[90%] space-y-2">
	{#if msg.plan}
		{@const planExpanded = isLastMessage && streaming ? true : isPlanExpanded}
		<div class="rounded-lg border border-violet-500/15 bg-violet-500/5">
			<button onclick={ontoggleplan} class="flex w-full items-center gap-2 px-3 py-2 text-left">
				<svg
					class="h-3 w-3 shrink-0 text-violet-400 transition-transform {planExpanded
						? 'rotate-90'
						: ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
				<svg
					class="h-3 w-3 shrink-0 text-violet-400"
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
				<span class="text-xs font-medium text-violet-400">Plan</span>
				{#if !planExpanded}
					<span class="truncate text-xs text-violet-400/50">{msg.plan.slice(0, 80)}...</span>
				{/if}
			</button>
			{#if planExpanded}
				<div class="border-t border-violet-500/10 px-3 py-2">
					<p class="text-xs leading-relaxed whitespace-pre-wrap text-violet-200/60">
						{msg.plan}
					</p>
				</div>
			{/if}
		</div>
	{/if}
	{#if isWaiting}
		<div
			class="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
		>
			<span class="thinking-dots flex gap-1">
				<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
				<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
				<span class="h-2 w-2 rounded-full bg-[var(--color-text-muted)]"></span>
			</span>
		</div>
	{/if}
	{#each isWaiting ? [] : segments as segment, segIdx}
		{#if segment.type === 'thinking'}
			{#if collapsibleThinking}
				{@const isCollapsed =
					isLastMessage && streaming ? false : !thinkingExpandedKeys.has(messageIdx * 100 + segIdx)}
				<div class="rounded-lg border border-amber-500/15 bg-amber-500/5">
					<button
						onclick={() => ontogglethinking(messageIdx * 100 + segIdx)}
						class="flex w-full items-center gap-2 px-3 py-2 text-left"
					>
						<svg
							class="h-3 w-3 shrink-0 text-amber-400 transition-transform {isCollapsed
								? ''
								: 'rotate-90'}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
						</svg>
						<span class="text-xs font-medium text-amber-400">Thinking</span>
						{#if isCollapsed}
							<span class="truncate text-xs text-amber-400/50"
								>{segment.content.slice(0, 80)}...</span
							>
						{/if}
					</button>
					{#if !isCollapsed}
						<div class="border-t border-amber-500/10 px-3 py-2">
							<p class="text-xs leading-relaxed whitespace-pre-wrap text-amber-200/60">
								{segment.content}
							</p>
						</div>
					{/if}
				</div>
			{:else}
				<div class="rounded-lg border border-amber-500/15 bg-amber-500/5">
					<div class="px-3 py-2">
						<span class="text-xs font-medium text-amber-400">Thinking</span>
						<p class="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-amber-200/60">
							{segment.content}
						</p>
					</div>
				</div>
			{/if}
		{:else}
			<div
				class="chat-message assistant-content rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3"
			>
				{@html renderMarkdown(segment.content)}
			</div>
		{/if}
	{/each}
</div>
