<script lang="ts">
	import type { Conversation, ServerInfo } from '$lib/types/chat';

	interface Props {
		ontogglesidebar: () => void;
		activeConversation: Conversation | null;
		serverInfo: ServerInfo | null;
		exportOpen: boolean;
		onexport: (format: 'markdown' | 'json') => void;
		ontoggleexport: () => void;
		toolsEnabled: boolean;
		ontoggletools: () => void;
		memoryEnabled: boolean;
		ontogglememory: () => void;
		samplingOpen: boolean;
		ontogglesampling: () => void;
		systemPromptOpen: boolean;
		ontogglesystemprompt: () => void;
		logsOpen: boolean;
		ontogglelogs: () => void;
	}

	let {
		ontogglesidebar,
		activeConversation,
		serverInfo,
		exportOpen,
		onexport,
		ontoggleexport,
		toolsEnabled,
		ontoggletools,
		memoryEnabled,
		ontogglememory,
		samplingOpen,
		ontogglesampling,
		systemPromptOpen,
		ontogglesystemprompt,
		logsOpen,
		ontogglelogs
	}: Props = $props();
</script>

<div class="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
	<button
		onclick={ontogglesidebar}
		class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
		aria-label="Toggle conversations"
	>
		<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
		</svg>
	</button>

	<span class="flex-1 text-xs font-medium text-[var(--color-text-secondary)]">
		{#if activeConversation}
			{activeConversation.title || 'Chat'}
		{:else}
			New Chat
		{/if}
	</span>

	<!-- Model indicator -->
	{#if activeConversation?.model_name}
		<div
			class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
		>
			{#if serverInfo?.status === 'ready' && serverInfo.modelId === activeConversation.model_id}
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
			{:else}
				<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]"></span>
			{/if}
			<span
				class="max-w-48 truncate font-mono text-xs text-[var(--color-text-secondary)]"
				title={activeConversation.model_name}>{activeConversation.model_name}</span
			>
			{#if serverInfo?.status === 'ready' && serverInfo.modelId === activeConversation.model_id && serverInfo.lastTokensPerSecond != null}
				<span class="font-mono text-xs text-[var(--color-accent)]"
					>{serverInfo.lastTokensPerSecond.toFixed(1)} t/s</span
				>
			{/if}
		</div>
	{:else if serverInfo?.status === 'ready' && serverInfo.modelName}
		<div
			class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
		>
			<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
			<span
				class="max-w-48 truncate font-mono text-xs text-[var(--color-text-secondary)]"
				title={serverInfo.modelName}>{serverInfo.modelName}</span
			>
			{#if serverInfo.lastTokensPerSecond != null}
				<span class="font-mono text-xs text-[var(--color-accent)]"
					>{serverInfo.lastTokensPerSecond.toFixed(1)} t/s</span
				>
			{/if}
		</div>
	{:else if serverInfo?.status === 'starting'}
		<div
			class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
			<span class="text-xs text-[var(--color-text-muted)]">Loading model...</span>
		</div>
	{:else}
		<div
			class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
		>
			<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]"></span>
			<span class="text-xs text-[var(--color-text-muted)]">No model</span>
		</div>
	{/if}

	<!-- Export dropdown -->
	{#if activeConversation}
		<div class="relative">
			<button
				onclick={ontoggleexport}
				class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
				aria-label="Export chat"
				title="Export chat"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
					/>
				</svg>
			</button>
			{#if exportOpen}
				<div
					class="absolute right-0 z-10 mt-1 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] py-1 shadow-lg"
				>
					<button
						onclick={() => onexport('markdown')}
						class="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
						>Export MD</button
					>
					<button
						onclick={() => onexport('json')}
						class="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
						>Export JSON</button
					>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Tools toggle (wrench icon) -->
	<button
		onclick={ontoggletools}
		class="rounded p-1.5 transition-colors {toolsEnabled
			? 'text-[var(--color-accent)]'
			: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
		title={toolsEnabled ? 'Tools enabled' : 'Tools disabled'}
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
			/>
		</svg>
	</button>

	<!-- Memory toggle (note icon) -->
	{#if toolsEnabled}
		<button
			onclick={ontogglememory}
			class="rounded p-1.5 transition-colors {memoryEnabled
				? 'text-[var(--color-accent)]'
				: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
			title={memoryEnabled ? 'Memory enabled' : 'Memory disabled'}
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
				/>
			</svg>
		</button>
	{/if}

	<!-- Sampling toggle -->
	<button
		onclick={ontogglesampling}
		class="rounded p-1.5 transition-colors {samplingOpen
			? 'text-[var(--color-accent)]'
			: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
		title="Sampling parameters"
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
			/>
		</svg>
	</button>

	<!-- System prompt toggle -->
	<button
		onclick={ontogglesystemprompt}
		class="rounded p-1.5 transition-colors {systemPromptOpen
			? 'text-[var(--color-accent)]'
			: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
		title="System prompt"
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
			/>
		</svg>
	</button>

	<!-- Server logs toggle -->
	<button
		onclick={ontogglelogs}
		class="rounded p-1.5 transition-colors {logsOpen
			? 'text-[var(--color-accent)]'
			: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
		title="Server logs"
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
			/>
		</svg>
	</button>
</div>
