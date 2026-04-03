<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import 'highlight.js/styles/github-dark.css';
	import type { Message, TokenUsage, ServerInfo } from '$lib/types/chat';
	import { linkifyText } from '$lib/utils/chat';
	import ToolMessage from './ToolMessage.svelte';
	import ApprovalMessage from './ApprovalMessage.svelte';
	import SandboxBlockedMessage from './SandboxBlockedMessage.svelte';
	import AssistantMessage from './AssistantMessage.svelte';

	interface Props {
		messages: Message[];
		input: string;
		streaming: boolean;
		activeConversationId: number | null;
		serverInfo: ServerInfo | null;
		tokenUsage: TokenUsage | null;
		collapsibleThinking?: boolean;
		showApprovals?: boolean;
		explorationSteps?: Array<{ tool: string; summary: string; preview: string }>;
		inputPrefix?: Snippet;
		inputSuffix?: Snippet;
		inputHeader?: Snippet;
		extraActions?: Snippet;
		onsend: () => void;
		onstop: () => void;
		onapproval?: (requestId: string, approved: boolean, remember?: boolean) => void;
		onallowpath?: (absolutePath: string, displayPath: string, requestId?: string) => void;
		ondismisssandbox?: (requestId: string) => void;
		onsaveEdit: (idx: number, newContent: string) => Promise<void>;
		disabled: boolean;
		placeholder: string;
		hasAttachments?: boolean;
	}

	let {
		messages = $bindable(),
		input = $bindable(),
		streaming = $bindable(),
		activeConversationId,
		serverInfo,
		tokenUsage,
		collapsibleThinking = true,
		showApprovals = false,
		explorationSteps = [],
		inputPrefix,
		inputSuffix,
		inputHeader,
		extraActions,
		onsend,
		onstop,
		onapproval,
		onallowpath,
		ondismisssandbox,
		onsaveEdit,
		disabled,
		placeholder,
		hasAttachments = false
	}: Props = $props();

	// Internal state
	let expandedThinking = $state<Set<number>>(new Set());
	let expandedPlans = $state<Set<number>>(new Set());
	let expandedTools = $state<Set<number>>(new Set());
	let editingMessageIdx = $state<number | null>(null);
	let editInput = $state('');
	let messagesContainer = $state<HTMLDivElement | undefined>();
	let textareaEl = $state<HTMLTextAreaElement | undefined>();

	// Reset textarea height when input is cleared
	$effect(() => {
		if (!input && textareaEl) {
			textareaEl.style.height = 'auto';
		}
	});

	function toggleThinking(key: number) {
		const next = new Set(expandedThinking);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedThinking = next;
	}

	function togglePlan(key: number) {
		const next = new Set(expandedPlans);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedPlans = next;
	}

	function toggleTool(key: number) {
		const next = new Set(expandedTools);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedTools = next;
	}

	function scrollToBottom() {
		if (messagesContainer) {
			requestAnimationFrame(() => {
				if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	// Auto-scroll on new messages/content
	$effect(() => {
		if (messagesContainer && messages.length > 0) {
			messages[messages.length - 1]?.content;
			scrollToBottom();
		}
	});

	// Reset expanded state when conversation changes
	$effect(() => {
		void activeConversationId;
		expandedThinking = new Set();
		expandedPlans = new Set();
		expandedTools = new Set();
		editingMessageIdx = null;
		editInput = '';
	});

	// Wire code copy buttons after render
	$effect(() => {
		void messages.length;
		tick().then(() => {
			document.querySelectorAll('.code-copy').forEach((btn) => {
				if (btn.getAttribute('data-wired')) return;
				btn.setAttribute('data-wired', '1');
				btn.addEventListener('click', () => {
					const block = btn.closest('.code-block');
					const code = block?.querySelector('code');
					if (!code) return;
					const raw = code.innerText;
					navigator.clipboard.writeText(raw).then(() => {
						btn.textContent = 'Copied!';
						setTimeout(() => {
							btn.textContent = 'Copy';
						}, 1500);
					});
				});
			});
		});
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onsend();
		}
	}

	function startEditing(idx: number, content: string) {
		editingMessageIdx = idx;
		editInput = content;
	}

	function cancelEditing() {
		editingMessageIdx = null;
		editInput = '';
	}

	async function handleSaveEdit() {
		if (editingMessageIdx === null) return;
		const idx = editingMessageIdx;
		const text = editInput.trim();
		if (!text) return;
		editingMessageIdx = null;
		editInput = '';
		await onsaveEdit(idx, text);
	}

	export function focusTextarea() {
		textareaEl?.focus();
	}

	export function getMessagesContainer() {
		return messagesContainer;
	}
</script>

<!-- Messages -->
<div bind:this={messagesContainer} class="flex-1 overflow-y-auto px-4 py-6">
	{#if messages.length === 0 && !streaming}
		<div class="flex h-full flex-col items-center justify-center">
			{#if serverInfo?.status === 'ready' && serverInfo.modelName}
				<p class="font-mono text-sm text-[var(--color-text-secondary)]">
					{serverInfo.modelName}
				</p>
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">Send a message to start chatting</p>
			{:else}
				<p class="text-sm text-[var(--color-text-muted)]">No model loaded</p>
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">
					<a href="/models" class="text-[var(--color-accent)] hover:underline">Launch a model</a>
					to start chatting
				</p>
			{/if}
		</div>
	{:else}
		<div class="mx-auto max-w-3xl space-y-4">
			{#each messages as msg, idx}
				{#if msg.role === 'user'}
					<div class="flex justify-end">
						{#if editingMessageIdx === idx}
							<div class="flex w-full max-w-[85%] flex-col gap-2">
								<textarea
									bind:value={editInput}
									rows={3}
									class="w-full resize-none rounded-lg border border-[var(--color-accent)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none"
								></textarea>
								<div class="flex justify-end gap-2">
									<button
										onclick={cancelEditing}
										class="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
										>Cancel</button
									>
									<button
										onclick={handleSaveEdit}
										class="rounded bg-[var(--color-accent-dim)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]"
										>Save & Send</button
									>
								</div>
							</div>
						{:else}
							<div class="group/msg relative">
								{#if !streaming && msg.id}
									<button
										onclick={() => startEditing(idx, msg.content)}
										class="absolute top-1/2 -left-7 -translate-y-1/2 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-[var(--color-text-secondary)]"
										aria-label="Edit message"
										title="Edit message"
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
												d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
											/>
										</svg>
									</button>
								{/if}
								<div class="rounded-2xl rounded-br-sm bg-[var(--color-accent-dim)] px-4 py-2.5">
									<p class="user-content text-sm whitespace-pre-wrap text-white">
										{@html linkifyText(msg.content)}
									</p>
								</div>
								{#if msg.images && msg.images.length > 0}
									<div class="mt-1.5 flex flex-wrap gap-2">
										{#each msg.images as img (img.name)}
											<a href={img.dataUrl} target="_blank" rel="noopener noreferrer">
												<img
													src={img.dataUrl}
													alt={img.name}
													class="max-h-[28rem] max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-80"
												/>
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if (msg.role === 'tool_status' && msg.toolName !== 'done') || msg.role === 'tool'}
					<ToolMessage {msg} isExpanded={expandedTools.has(idx)} ontoggle={() => toggleTool(idx)} />
				{:else if msg.role === 'approval' && showApprovals}
					<ApprovalMessage
						{msg}
						onapproval={(reqId, approved, remember) => onapproval?.(reqId, approved, remember)}
					/>
				{:else if msg.role === 'sandbox_blocked' && showApprovals}
					<SandboxBlockedMessage
						{msg}
						onallowpath={(abs, display, reqId) => onallowpath?.(abs, display, reqId)}
						ondismiss={(reqId) => ondismisssandbox?.(reqId)}
					/>
				{:else if msg.role === 'assistant'}
					<AssistantMessage
						{msg}
						isWaiting={!msg.content && streaming && idx === messages.length - 1}
						isLastMessage={idx === messages.length - 1}
						{streaming}
						{collapsibleThinking}
						isPlanExpanded={expandedPlans.has(idx)}
						thinkingExpandedKeys={expandedThinking}
						messageIdx={idx}
						explorationSteps={idx === messages.length - 1 ? explorationSteps : []}
						ontogglethinking={toggleThinking}
						ontoggleplan={() => togglePlan(idx)}
					/>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<!-- Input area -->
<div class="border-t border-[var(--color-border)] px-4 py-3">
	{@render inputHeader?.()}
	<div class="mx-auto flex max-w-3xl gap-2">
		{@render inputPrefix?.()}
		<textarea
			bind:this={textareaEl}
			bind:value={input}
			onkeydown={handleKeydown}
			oninput={(e) => {
				const el = e.currentTarget;
				el.style.height = 'auto';
				el.style.height = Math.min(el.scrollHeight, 320) + 'px';
			}}
			{placeholder}
			rows="1"
			{disabled}
			class="max-h-80 min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
		></textarea>

		{#if streaming}
			<button
				onclick={onstop}
				class="shrink-0 self-end rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
				>Stop</button
			>
		{:else}
			<button
				onclick={onsend}
				disabled={(!input.trim() && !hasAttachments) || disabled}
				class="shrink-0 self-end rounded-lg bg-[var(--color-accent-dim)] px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-30"
				>Send</button
			>
		{/if}
		{@render extraActions?.()}
	</div>
	{@render inputSuffix?.()}
	{#if tokenUsage}
		{@const ctxSize = serverInfo?.contextSize ?? 0}
		{@const usagePercent = ctxSize > 0 ? Math.round((tokenUsage.total / ctxSize) * 100) : 0}
		<div class="mx-auto mt-2 flex max-w-3xl items-center gap-3">
			{#if ctxSize > 0}
				<div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface)]">
					<div
						class="h-full rounded-full transition-all {usagePercent > 90
							? 'bg-red-400'
							: usagePercent > 70
								? 'bg-amber-400'
								: 'bg-[var(--color-accent)]'}"
						style="width: {Math.min(usagePercent, 100)}%"
					></div>
				</div>
			{/if}
			<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
				{tokenUsage.total.toLocaleString()}{ctxSize > 0 ? ` / ${ctxSize.toLocaleString()}` : ''} tokens
				<span class="text-[var(--color-text-muted)]/60"
					>({tokenUsage.prompt.toLocaleString()}p + {tokenUsage.completion.toLocaleString()}c)</span
				>
			</span>
		</div>
	{/if}
</div>
