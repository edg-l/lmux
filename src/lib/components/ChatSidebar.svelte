<script lang="ts">
	import type { Conversation, ServerInfo } from '$lib/types/chat';

	interface Props {
		filteredConversations: Conversation[];
		activeConversationId: number | null;
		searchQuery: string;
		allTags: string[];
		activeTag: string | null;
		editingTagsConvId: number | null;
		tagInput: string;
		confirmDeleteId: number | null;
		serverInfo: ServerInfo | null;
		onNewConversation: () => void;
		onSelectConversation: (id: number) => void;
		onDeleteConversation: (id: number) => void;
		onStartEditingTags: (conv: Conversation) => void;
		onFinishEditingTags: () => void;
		onSetActiveTag: (tag: string | null) => void;
		onSetConfirmDeleteId: (id: number | null) => void;
	}

	let {
		filteredConversations,
		activeConversationId,
		searchQuery = $bindable(),
		allTags,
		activeTag = $bindable(),
		editingTagsConvId = $bindable(),
		tagInput = $bindable(),
		confirmDeleteId = $bindable(),
		serverInfo,
		onNewConversation,
		onSelectConversation,
		onDeleteConversation,
		onStartEditingTags,
		onFinishEditingTags,
		onSetActiveTag,
		onSetConfirmDeleteId
	}: Props = $props();

	function formatTime(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		return `${Math.floor(hrs / 24)}d`;
	}
</script>

<div
	class="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)]"
>
	<div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
		<span class="text-xs font-medium text-[var(--color-text-muted)]">Conversations</span>
		<button
			onclick={onNewConversation}
			class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)]"
			>New</button
		>
	</div>

	<div class="px-2 py-1.5">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search..."
			class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-secondary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
		/>
	</div>

	{#if allTags.length > 0}
		<div class="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2 py-1.5">
			{#each allTags as tag}
				<button
					onclick={() => onSetActiveTag(activeTag === tag ? null : tag)}
					class="rounded-full px-2 py-0.5 text-xs transition-colors {activeTag === tag
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto">
		{#each filteredConversations as conv}
			<div
				class="group flex items-center border-b border-[var(--color-border)]/30 {activeConversationId ===
				conv.id
					? 'border-l-2 border-l-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
					: 'hover:bg-[var(--color-surface)]'}"
			>
				<button
					onclick={() => onSelectConversation(conv.id)}
					class="min-w-0 flex-1 px-3 py-2 text-left"
				>
					<p
						class="truncate text-xs font-medium {activeConversationId === conv.id
							? 'text-[var(--color-accent)]'
							: 'text-[var(--color-text-primary)]'}"
					>
						{conv.title || 'Untitled'}
					</p>
					<div class="mt-0.5 flex items-center gap-1.5">
						{#if conv.model_name}
							<span
								class="inline-flex items-center gap-1 truncate font-mono text-[10px] text-[var(--color-accent)]/60"
							>
								<svg
									class="h-2.5 w-2.5 shrink-0"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z"
									/>
								</svg>
								{conv.model_name}
							</span>
						{:else if conv.model_id !== null && !conv.model_name}
							<span class="text-[10px] text-red-400/60">Model removed</span>
						{/if}
						<span class="font-mono text-[10px] text-[var(--color-text-muted)]">
							{formatTime(conv.updated_at)}
						</span>
					</div>
					{#if conv.tags}
						<div class="mt-0.5 flex flex-wrap gap-0.5">
							{#each conv.tags
								.split(',')
								.map((t) => t.trim())
								.filter(Boolean) as tag}
								<span
									class="rounded-full bg-[var(--color-accent)]/15 px-1.5 py-0 text-[10px] text-[var(--color-accent)]"
									>{tag}</span
								>
							{/each}
						</div>
					{/if}
				</button>
				{#if editingTagsConvId === conv.id}
					<div class="mr-2 flex items-center">
						<input
							type="text"
							bind:value={tagInput}
							onblur={onFinishEditingTags}
							onkeydown={(e) => {
								if (e.key === 'Enter') onFinishEditingTags();
							}}
							placeholder="tag1, tag2"
							class="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-[10px] text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
				{:else if confirmDeleteId === conv.id}
					<button
						onclick={() => onDeleteConversation(conv.id)}
						class="mr-1 px-1.5 py-0.5 text-xs text-red-400">Yes</button
					>
					<button
						onclick={() => onSetConfirmDeleteId(null)}
						class="mr-2 text-xs text-[var(--color-text-muted)]">No</button
					>
				{:else}
					<div class="mr-2 flex items-center gap-1 opacity-0 group-hover:opacity-100">
						<button
							onclick={(e) => {
								e.stopPropagation();
								onStartEditingTags(conv);
							}}
							class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
							title="Edit tags"
						>
							<svg
								class="h-3 w-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
								/>
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z" />
							</svg>
						</button>
						<button
							onclick={() => onSetConfirmDeleteId(conv.id)}
							class="text-xs text-[var(--color-text-muted)] hover:text-red-400">Del</button
						>
					</div>
				{/if}
			</div>
		{/each}
		{#if filteredConversations.length === 0}
			<p class="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
				{searchQuery.trim() ? 'No matches' : 'No conversations'}
			</p>
		{/if}
	</div>

	<!-- Server status bar -->
	<div class="border-t border-[var(--color-border)] px-3 py-2">
		{#if serverInfo?.status === 'ready' && serverInfo.modelName}
			<div class="flex items-center gap-2">
				<span class="h-2 w-2 shrink-0 rounded-full bg-emerald-400"></span>
				<span
					class="truncate font-mono text-xs text-[var(--color-text-secondary)]"
					title={serverInfo.modelName}>{serverInfo.modelName}</span
				>
			</div>
		{:else if serverInfo?.status === 'starting'}
			<div class="flex items-center gap-2">
				<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400"></span>
				<span class="text-xs text-amber-400">Loading model...</span>
			</div>
		{:else}
			<div class="flex items-center gap-2 rounded-md bg-red-500/10 px-2 py-1">
				<span class="h-2 w-2 shrink-0 rounded-full bg-red-400"></span>
				<span class="text-xs font-medium text-red-400">Server stopped</span>
			</div>
		{/if}
	</div>
</div>
