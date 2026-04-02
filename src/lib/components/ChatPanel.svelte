<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { renderMarkdown } from '$lib/markdown';
	import 'highlight.js/styles/github-dark.css';
	import type { Message, TokenUsage, ServerInfo } from '$lib/types/chat';
	import {
		parseThinking,
		linkifyText,
		getToolSummary,
		getToolLabel,
		getToolElapsed,
		highlightDangers
	} from '$lib/utils/chat';

	interface DiffLine {
		type: '+' | '-' | ' ';
		lineNum: number;
		content: string;
	}

	function extractDiffSnippet(content: string): { summary: string; diff: DiffLine[] | null } {
		// New format: lines are "TYPE:LINENUM:CONTENT"
		const lines = content.split('\n');
		const diffLines: DiffLine[] = [];
		const summaryLines: string[] = [];
		let inDiff = false;

		for (const line of lines) {
			const match = line.match(/^([+ -]):(\d+):(.*)$/);
			if (match) {
				inDiff = true;
				diffLines.push({
					type: match[1] as '+' | '-' | ' ',
					lineNum: parseInt(match[2]),
					content: match[3]
				});
			} else if (!inDiff) {
				summaryLines.push(line);
			}
		}

		return {
			summary: summaryLines.join('\n').trim(),
			diff: diffLines.length > 0 ? diffLines : null
		};
	}

	interface Props {
		messages: Message[];
		input: string;
		streaming: boolean;
		activeConversationId: number | null;
		serverInfo: ServerInfo | null;
		tokenUsage: TokenUsage | null;
		collapsibleThinking?: boolean;
		showApprovals?: boolean;
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
											<img
												src={img.dataUrl}
												alt={img.name}
												class="max-h-[28rem] max-w-full rounded-lg border border-white/10 object-contain"
											/>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if msg.role === 'tool_status'}
					{@const isExpanded = expandedTools.has(idx)}
					{@const toolSummary = getToolSummary(msg.toolName, msg.toolArgs)}
					{@const parsed =
						msg.toolStatus === 'done' && msg.content ? extractDiffSnippet(msg.content) : null}
					<div
						class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)] {msg.toolError
							? 'border-l-red-500/40'
							: 'border-l-cyan-500/40'}"
					>
						<button
							onclick={() => toggleTool(idx)}
							class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
						>
							<svg
								class="h-3 w-3 shrink-0 text-cyan-400 transition-transform {isExpanded
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
								class="h-3 w-3 shrink-0 text-cyan-400/70"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
								/>
							</svg>
							<span class="text-xs font-medium text-cyan-400/80">{getToolLabel(msg.toolName)}</span>
							{#if toolSummary}
								<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]"
									>{toolSummary}</span
								>
							{/if}
							{#if msg.toolStatus === 'done' && getToolElapsed(msg.content)}
								<span class="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">{getToolElapsed(msg.content)}</span>
							{/if}
							{#if msg.toolStatus === 'running'}
								<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cyan-400"></span>
							{:else if msg.toolError}
								<svg
									class="h-3 w-3 shrink-0 text-red-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							{:else}
								<svg
									class="h-3 w-3 shrink-0 text-emerald-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							{/if}
						</button>
						{#if parsed?.diff}
							<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
								<div class="font-mono text-xs leading-relaxed">
									{#each parsed.diff as dl}
										<div
											class="flex {dl.type === '+'
												? 'bg-emerald-500/10'
												: dl.type === '-'
													? 'bg-red-500/10'
													: ''}"
										>
											<span
												class="w-8 shrink-0 pr-2 text-right text-[var(--color-text-muted)] select-none"
												>{dl.lineNum || ''}</span
											>
											<span
												class="w-4 shrink-0 select-none {dl.type === '+'
													? 'text-emerald-400'
													: dl.type === '-'
														? 'text-red-400'
														: 'text-[var(--color-text-muted)]'}"
												>{dl.type === ' ' ? '' : dl.type}</span
											>
											<span
												class="whitespace-pre-wrap {dl.type === '+'
													? 'text-emerald-400'
													: dl.type === '-'
														? 'text-red-400'
														: 'text-[var(--color-text-muted)]'}">{dl.content}</span
											>
										</div>
									{/each}
								</div>
							</div>
						{:else if msg.toolError && msg.toolStatus === 'done' && msg.content}
							<div class="border-t border-red-500/10 px-2.5 py-1.5">
								<p class="text-xs text-red-400">{msg.content}</p>
							</div>
						{/if}
						{#if isExpanded}
							<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
								{#if msg.toolArgs}
									<p class="font-mono text-xs break-all text-cyan-300/60">
										{msg.toolArgs}
									</p>
								{/if}
								{#if msg.toolStatus === 'done' && msg.content && !msg.toolError}
									<p
										class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
									>
										{parsed ? parsed.summary : msg.content}
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{:else if msg.role === 'tool'}
					{@const isExpanded = expandedTools.has(idx)}
					{@const toolSummary = getToolSummary(msg.toolName, msg.toolArgs)}
					{@const parsed = msg.content ? extractDiffSnippet(msg.content) : null}
					<div
						class="max-w-[90%] rounded-lg border border-l-2 border-[var(--color-border)] bg-[var(--color-elevated)] {msg.toolError
							? 'border-l-red-500/40'
							: 'border-l-cyan-500/40'}"
					>
						<button
							onclick={() => toggleTool(idx)}
							class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
						>
							<svg
								class="h-3 w-3 shrink-0 text-cyan-400 transition-transform {isExpanded
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
								class="h-3 w-3 shrink-0 text-cyan-400/70"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M11.42 15.17l-5.09-5.09a3.004 3.004 0 010-4.25 3.004 3.004 0 014.25 0l.34.34.34-.34a3.004 3.004 0 014.25 0 3.004 3.004 0 010 4.25l-5.09 5.09zM21.17 8.04l-4.25-4.25a2 2 0 00-2.83 0L12 5.88l-2.09-2.09a2 2 0 00-2.83 0L2.83 8.04a2 2 0 000 2.83L12 20l9.17-9.13a2 2 0 000-2.83z"
								/>
							</svg>
							<span class="text-xs font-medium text-cyan-400/80">{getToolLabel(msg.toolName)}</span>
							{#if toolSummary}
								<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]"
									>{toolSummary}</span
								>
							{/if}
							{#if getToolElapsed(msg.content)}
								<span class="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">{getToolElapsed(msg.content)}</span>
							{/if}
							{#if msg.toolError}
								<svg
									class="h-3 w-3 shrink-0 text-red-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							{:else}
								<svg
									class="h-3 w-3 shrink-0 text-emerald-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							{/if}
						</button>
						{#if parsed?.diff}
							<div class="border-t border-cyan-500/10 px-2.5 py-1.5">
								<div class="font-mono text-xs leading-relaxed">
									{#each parsed.diff as dl}
										<div
											class="flex {dl.type === '+'
												? 'bg-emerald-500/10'
												: dl.type === '-'
													? 'bg-red-500/10'
													: ''}"
										>
											<span
												class="w-8 shrink-0 pr-2 text-right text-[var(--color-text-muted)] select-none"
												>{dl.lineNum || ''}</span
											>
											<span
												class="w-4 shrink-0 select-none {dl.type === '+'
													? 'text-emerald-400'
													: dl.type === '-'
														? 'text-red-400'
														: 'text-[var(--color-text-muted)]'}"
												>{dl.type === ' ' ? '' : dl.type}</span
											>
											<span
												class="whitespace-pre-wrap {dl.type === '+'
													? 'text-emerald-400'
													: dl.type === '-'
														? 'text-red-400'
														: 'text-[var(--color-text-muted)]'}">{dl.content}</span
											>
										</div>
									{/each}
								</div>
							</div>
						{:else if msg.toolError && msg.content}
							<div class="border-t border-red-500/10 px-2.5 py-1.5">
								<p class="text-xs text-red-400">{msg.content}</p>
							</div>
						{/if}
						{#if isExpanded}
							<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
								{#if msg.toolArgs}
									<p class="font-mono text-xs break-all text-cyan-300/60">
										{msg.toolArgs}
									</p>
								{/if}
								{#if !msg.toolError}
									<p
										class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
									>
										{parsed ? parsed.summary : msg.content}
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{:else if msg.role === 'approval' && showApprovals}
					{@const approval = msg.approval}
					{#if approval}
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
								<div class="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
									Command approval required:
								</div>
								<pre
									class="mb-2 overflow-x-auto rounded bg-[var(--color-surface)] p-2 font-mono text-xs text-[var(--color-text-primary)]">{@html highlightDangers(
										approval.command,
										approval.dangers
									)}</pre>
								{#if !approval.resolved}
									<div class="flex items-center gap-2">
										<button
											onclick={() => onapproval?.(approval.requestId, true)}
											class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
										>
											Approve
										</button>
										<button
											onclick={() => onapproval?.(approval.requestId, true, true)}
											class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
										>
											Always Allow
										</button>
										<button
											onclick={() => onapproval?.(approval.requestId, false)}
											class="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
										>
											Deny
										</button>
									</div>
								{:else}
									<span
										class="text-xs font-medium {approval.approved
											? 'text-emerald-400'
											: 'text-red-400'}"
									>
										{approval.approved ? 'Approved' : 'Denied'}
									</span>
								{/if}
							</div>
						</div>
					{/if}
				{:else if msg.role === 'sandbox_blocked' && showApprovals}
					{@const sb = msg.sandboxBlocked}
					{#if sb}
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
												onclick={() =>
													onallowpath?.(sb.absolutePaths[i], displayPath, sb.requestId)}
												class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
											>
												Allow {displayPath}
											</button>
											{#if sb.requestId}
												<button
													onclick={() => ondismisssandbox?.(sb.requestId ?? '')}
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
				{:else if msg.role === 'assistant'}
					{@const isWaiting = !msg.content && streaming && idx === messages.length - 1}
					{@const segments = parseThinking(msg.content || (isWaiting ? '...' : ''))}
					<div class="max-w-[90%] space-y-2">
						{#if msg.plan}
							{@const isLast = idx === messages.length - 1}
							{@const isPlanExpanded = isLast && streaming ? true : expandedPlans.has(idx)}
							<div class="rounded-lg border border-violet-500/15 bg-violet-500/5">
								<button
									onclick={() => togglePlan(idx)}
									class="flex w-full items-center gap-2 px-3 py-2 text-left"
								>
									<svg
										class="h-3 w-3 shrink-0 text-violet-400 transition-transform {isPlanExpanded
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
									{#if !isPlanExpanded}
										<span class="truncate text-xs text-violet-400/50"
											>{msg.plan.slice(0, 80)}...</span
										>
									{/if}
								</button>
								{#if isPlanExpanded}
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
									{@const isLast = idx === messages.length - 1}
									{@const isCollapsed =
										isLast && streaming ? false : !expandedThinking.has(idx * 100 + segIdx)}
									<div class="rounded-lg border border-amber-500/15 bg-amber-500/5">
										<button
											onclick={() => toggleThinking(idx * 100 + segIdx)}
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
			{placeholder}
			rows="1"
			{disabled}
			class="max-h-[160px] min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
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

<style>
	.thinking-dots span {
		animation: thinking-bounce 1.4s infinite ease-in-out;
	}
	.thinking-dots span:nth-child(1) {
		animation-delay: 0s;
	}
	.thinking-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.thinking-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes thinking-bounce {
		0%,
		80%,
		100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}
	:global(.user-content a) {
		color: white;
		text-decoration: underline;
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
		opacity: 0.9;
	}
	:global(.user-content a:hover) {
		opacity: 1;
	}
	:global(.assistant-content .code-block) {
		margin: 0.75rem 0;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		background: #0d1117;
	}
	:global(.assistant-content .code-block .code-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.75rem;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.03);
		border-bottom: 1px solid var(--color-border);
		font-family: ui-monospace, monospace;
	}
	:global(.assistant-content .code-block .code-copy) {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		font-family: inherit;
	}
	:global(.assistant-content .code-block .code-copy:hover) {
		color: var(--color-text-secondary);
		background: rgba(255, 255, 255, 0.06);
	}
	:global(.assistant-content .code-content) {
		margin: 0;
		padding: 0.5rem 0.75rem 0.5rem 0;
		font-size: 0.8rem;
		line-height: 1.4;
		overflow-x: auto;
	}
	:global(.assistant-content .code-content code) {
		background: none;
		padding: 0;
		counter-reset: line;
	}
	:global(.assistant-content .code-content code .line) {
		display: block;
	}
	:global(.assistant-content .code-content code .line::before) {
		counter-increment: line;
		content: counter(line);
		display: inline-block;
		width: 3ch;
		margin-right: 1rem;
		padding-right: 0.5rem;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.35;
		border-right: 1px solid var(--color-border);
		user-select: none;
		-webkit-user-select: none;
	}
	:global(.assistant-content .code-block .hljs) {
		background: none;
	}
	:global(.assistant-content a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: var(--color-accent);
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
	}
	:global(.assistant-content a:hover) {
		text-decoration-thickness: 2px;
	}
	/* Markdown rendering styles */
	:global(.chat-message) {
		font-size: 0.875rem;
		line-height: 1.625;
		color: var(--color-text-secondary);
	}
	:global(.chat-message p) {
		margin-bottom: 0.5rem;
	}
	:global(.chat-message p:last-child) {
		margin-bottom: 0;
	}
	:global(.chat-message strong) {
		color: var(--color-text-primary);
		font-weight: 600;
	}
	:global(.chat-message em) {
		font-style: italic;
	}
	:global(.chat-message code) {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.125rem 0.375rem;
	}
	:global(.chat-message pre) {
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0;
		overflow-x: auto;
	}
	:global(.chat-message pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-primary);
	}
	:global(.chat-message ul),
	:global(.chat-message ol) {
		padding-left: 1.25rem;
		margin: 0.5rem 0;
	}
	:global(.chat-message li) {
		margin-bottom: 0.25rem;
	}
	:global(.chat-message ul li) {
		list-style-type: disc;
	}
	:global(.chat-message ol li) {
		list-style-type: decimal;
	}
	:global(.chat-message h1),
	:global(.chat-message h2),
	:global(.chat-message h3) {
		color: var(--color-text-primary);
		font-weight: 600;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}
	:global(.chat-message h1) {
		font-size: 1.125rem;
	}
	:global(.chat-message h2) {
		font-size: 1rem;
	}
	:global(.chat-message h3) {
		font-size: 0.875rem;
	}
	:global(.chat-message blockquote) {
		border-left: 3px solid var(--color-accent);
		padding-left: 0.75rem;
		margin: 0.5rem 0;
		color: var(--color-text-muted);
	}
	:global(.chat-message a) {
		color: var(--color-accent);
		text-decoration: underline;
	}
	:global(.chat-message hr) {
		border-color: var(--color-border);
		margin: 0.75rem 0;
	}
	:global(.chat-message table) {
		border-collapse: collapse;
		margin: 0.5rem 0;
		font-size: 0.8125rem;
	}
	:global(.chat-message th),
	:global(.chat-message td) {
		border: 1px solid var(--color-border);
		padding: 0.375rem 0.625rem;
	}
	:global(.chat-message th) {
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-weight: 600;
	}
</style>
