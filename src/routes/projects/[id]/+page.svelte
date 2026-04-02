<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import type { Message, TokenUsage } from '$lib/types/chat';
	import { processSSEStream } from '$lib/utils/stream';
	import {
		enrichToolMessages,
		exportChat as exportChatUtil,
		prepareMessagesForApi
	} from '$lib/utils/chat';
	import { getServerInfo, connectServerInfo } from '$lib/stores/server-info.svelte';

	interface Project {
		id: number;
		name: string;
		path: string;
		created_at: string;
	}

	interface FileEntry {
		name: string;
		type: 'file' | 'directory';
	}

	const projectId = parseInt(page.params.id ?? '0');

	let project = $state<Project | null>(null);
	let fileEntries = $state<FileEntry[]>([]);
	let activeTab = $state<'chat' | 'files'>('chat');
	let selectedFilePath = $state<string | null>(null);

	// Chat state
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let abortController: AbortController | null = $state(null);
	let tokenUsage: TokenUsage | null = $state(null);
	let changedFiles = $state<Map<string, 'created' | 'modified'>>(new Map());

	// Conversation state
	let activeConversationId: number | null = $state(null);

	// Server info
	let serverInfo = $derived(getServerInfo());

	// Session list ref
	let sessionListComponent: SessionList | undefined = $state();

	// Reasoning budget state
	let thinkingBudgetEnabled = $state(false);
	let thinkingBudgetValue = $state(4096);
	let thinkingBudget = $derived(thinkingBudgetEnabled ? thinkingBudgetValue : -1);
	let reasoningOpen = $state(false);

	// Component refs
	let fileTreeRef: FileTree | undefined = $state();
	let chatPanelRef: ChatPanel | undefined = $state();

	let cleanupServerInfo: (() => void) | null = null;

	onMount(() => {
		loadProject();
		loadFiles();
		loadGitStatus();
		cleanupServerInfo = connectServerInfo();

		function handleGlobalKeydown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				e.preventDefault();
				newConversation();
			}
			if (e.key === 'Escape' && streaming) {
				abortController?.abort();
			}
		}
		window.addEventListener('keydown', handleGlobalKeydown);

		return () => {
			cleanupServerInfo?.();
			window.removeEventListener('keydown', handleGlobalKeydown);
		};
	});

	async function loadProject() {
		try {
			const res = await fetch(`/api/projects/${projectId}`);
			if (res.ok) {
				project = await res.json();
			} else {
				goto('/projects');
			}
		} catch {
			goto('/projects');
		}
	}

	async function loadGitStatus() {
		try {
			const res = await fetch(`/api/projects/${projectId}/status`);
			if (res.ok) {
				const data = await res.json();
				if (data.isGit && data.files.length > 0) {
					const newChanged = new Map<string, 'created' | 'modified'>();
					for (const f of data.files) {
						newChanged.set(f.path, f.operation);
					}
					changedFiles = newChanged;
				}
			}
		} catch {
			// Not critical
		}
	}

	async function loadFiles() {
		try {
			const res = await fetch(`/api/projects/${projectId}/files`);
			if (res.ok) {
				const data = await res.json();
				fileEntries = data.entries;
			}
		} catch {
			// ignore
		}
	}


	async function selectConversation(id: number) {
		activeConversationId = id;
		changedFiles = new Map();
		activeTab = 'chat';
		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (res.ok) {
				const data = await res.json();
				messages = enrichToolMessages(data.messages ?? []);
			}
		} catch {
			messages = [];
		}
	}

	async function newConversation() {
		activeConversationId = null;
		messages = [];
		input = '';
		tokenUsage = null;
		changedFiles = new Map();
		activeTab = 'chat';
	}

	async function ensureConversation(): Promise<number> {
		if (activeConversationId) return activeConversationId;

		const modelId = serverInfo?.modelId ?? null;
		if (!modelId) throw new Error('No model running');

		const title = input.trim().slice(0, 50) || 'New conversation';
		const res = await fetch(`/api/projects/${projectId}/conversations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, modelId })
		});
		const data = await res.json();
		activeConversationId = data.id;
		sessionListComponent?.loadConversations();
		return data.id;
	}

	async function saveMessage(
		conversationId: number,
		role: string,
		content: string,
		opts?: { toolCallId?: string; toolCalls?: string; tokenCount?: number }
	): Promise<number | null> {
		try {
			const res = await fetch(`/api/conversations/${conversationId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					role,
					content,
					...(opts?.toolCallId && { toolCallId: opts.toolCallId }),
					...(opts?.toolCalls && { toolCalls: opts.toolCalls }),
					...(opts?.tokenCount != null && { tokenCount: opts.tokenCount })
				})
			});
			if (res.ok) {
				const data = await res.json();
				return data.id;
			}
		} catch {
			// ignore
		}
		return null;
	}

	async function handleApproval(requestId: string, approved: boolean, remember = false) {
		try {
			await fetch('/api/approve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestId, approved, remember })
			});
		} catch {
			// ignore
		}
		// Mark approval as resolved in messages
		messages = messages.map((m) => {
			if (m.approval?.requestId === requestId) {
				return {
					...m,
					approval: { ...m.approval, resolved: true, approved }
				};
			}
			return m;
		});
	}

	async function handleAllowPath(absolutePath: string, displayPath: string, requestId?: string) {
		try {
			await fetch('/api/sandbox/allow-path', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: absolutePath, requestId })
			});
		} catch {
			// ignore
		}
		messages = messages.map((m) => {
			if (m.sandboxBlocked && m.sandboxBlocked.absolutePaths.includes(absolutePath)) {
				return {
					...m,
					sandboxBlocked: { ...m.sandboxBlocked, resolved: true, allowedPath: displayPath }
				};
			}
			return m;
		});
	}

	async function handleDismissSandbox(requestId: string) {
		try {
			await fetch('/api/sandbox/resolve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestId, allowed: false })
			});
		} catch {
			// ignore
		}
		messages = messages.map((m) => {
			if (m.sandboxBlocked && m.sandboxBlocked.requestId === requestId) {
				return {
					...m,
					sandboxBlocked: { ...m.sandboxBlocked, resolved: true }
				};
			}
			return m;
		});
	}

	async function sendMessage() {
		const text = input.trim();
		if (!text || streaming) return;

		let conversationId: number;
		try {
			conversationId = await ensureConversation();
		} catch {
			return;
		}

		messages = [...messages, { role: 'user', content: text }];
		input = '';
		await saveMessage(conversationId, 'user', text);
		messages = [...messages, { role: 'assistant', content: '' }];

		streaming = true;
		const controller = new AbortController();
		abortController = controller;

		try {
			const chatMessages = prepareMessagesForApi(messages.slice(0, -1));

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: chatMessages,
					sampling: {
						thinking_budget: thinkingBudget
					},
					tools_enabled: true,
					model_id: serverInfo?.modelId ?? null,
					project_id: projectId
				}),
				signal: controller.signal
			});

			if (!res.ok) {
				const error = await res.json();
				messages = messages.map((m, i) =>
					i === messages.length - 1
						? { ...m, content: `Error: ${error.error ?? 'Request failed'}` }
						: m
				);
				streaming = false;
				abortController = null;
				return;
			}

			if (!res.body) {
				streaming = false;
				abortController = null;
				return;
			}

			const { pendingToolMessages } = await processSSEStream(res, controller.signal, {
				onDelta: (content) => {
					// Ensure there's an assistant message to append to
					const lastMsg = messages[messages.length - 1];
					if (!lastMsg || lastMsg.role !== 'assistant') {
						messages = [...messages, { role: 'assistant', content: '' }];
					}
					messages = messages.map((m, i) =>
						i === messages.length - 1 ? { ...m, content: m.content + content } : m
					);
				},
				onToolCall: (tc) => {
					messages = [
						...messages,
						{
							role: 'tool_status',
							content: '',
							toolName: tc.function.name,
							toolArgs: tc.function.arguments,
							toolStatus: 'running',
							tool_call_id: tc.id
						}
					];
				},
				onToolResult: (id, content, statusIdx, error) => {
					if (statusIdx !== undefined) {
						messages = messages.map((m, i) =>
							i === statusIdx ? { ...m, content, toolStatus: 'done' as const, toolError: error } : m
						);
					}
					// Add assistant placeholder so thinking dots show while model processes
					messages = [...messages, { role: 'assistant', content: '' }];
				},
				getAssistantContent: (toolCallCount) => {
					const lastAssistant = messages[messages.length - toolCallCount - 1];
					return lastAssistant?.role === 'assistant' ? lastAssistant.content : '';
				},
				onUsage: (usage) => {
					tokenUsage = usage;
				},
				getMessageCount: () => messages.length,
				onApprovalRequest: (data) => {
					messages = [
						...messages,
						{
							role: 'approval',
							content: '',
							approval: {
								requestId: data.requestId,
								command: data.command,
								dangers: data.dangers,
								sandboxed: data.sandboxed,
								resolved: false,
								approved: null
							}
						}
					];
				},
				onSandboxBlocked: (data) => {
					messages = [
						...messages,
						{
							role: 'sandbox_blocked',
							content: '',
							sandboxBlocked: {
								requestId: data.requestId,
								paths: data.paths,
								absolutePaths: data.absolutePaths
							}
						}
					];
				},
				onFileChanged: (data) => {
					const newChanged = new Map(changedFiles);
					newChanged.set(data.path, data.operation as 'created' | 'modified');
					changedFiles = newChanged;

					if (data.operation === 'created') {
						const parentDir = data.path.includes('/')
							? data.path.substring(0, data.path.lastIndexOf('/'))
							: '';
						fileTreeRef?.refreshDirectory(parentDir);
					}
				}
			});

			for (const tm of pendingToolMessages) {
				await saveMessage(conversationId, tm.role, tm.content, {
					toolCalls: tm.toolCalls,
					toolCallId: tm.toolCallId
				});
			}

			const lastMsg = messages[messages.length - 1];
			if (lastMsg?.role === 'assistant' && lastMsg.content) {
				await saveMessage(conversationId, 'assistant', lastMsg.content);
			}
		} catch {
			messages = messages.map((m, i) =>
				i === messages.length - 1 ? { ...m, content: m.content || 'Error: Connection failed' } : m
			);
		} finally {
			streaming = false;
			abortController = null;
			sessionListComponent?.loadConversations();
			tick().then(() => chatPanelRef?.focusTextarea());
		}
	}

	function stopGeneration() {
		abortController?.abort();
	}

	async function handleSaveEdit(idx: number, newContent: string) {
		const msg = messages[idx];
		if (!msg?.id || !activeConversationId) return;

		// Delete messages from this one onward on the server
		await fetch(`/api/conversations/${activeConversationId}/messages`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromMessageId: msg.id })
		});

		// Truncate local messages
		messages = messages.slice(0, idx);

		// Set as new input and auto-send
		input = newContent;
		await tick();
		sendMessage();
	}

	function exportChat(format: 'markdown' | 'json') {
		exportChatUtil(messages, activeConversationId, format);
	}

	function handleFileSelect(path: string) {
		selectedFilePath = path;
		activeTab = 'files';
	}
</script>

{#if !project}
	<div class="flex h-screen items-center justify-center">
		<p class="text-sm text-[var(--color-text-muted)]">Loading project...</p>
	</div>
{:else}
	<div class="workspace-container -m-5 flex h-screen flex-col md:-m-8">
		<!-- Top bar -->
		<div
			class="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2"
		>
			<div class="flex items-center gap-3">
				<a
					href="/projects"
					title="Back to projects"
					class="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
					</svg>
				</a>
				<span class="text-sm font-medium text-[var(--color-text-primary)]">{project.name}</span>
				<span class="font-mono text-xs text-[var(--color-text-muted)]">{project.path}</span>
			</div>
			<div class="flex items-center gap-2">
				{#if messages.length > 0}
					<div class="flex items-center gap-1">
						<button
							onclick={() => exportChat('markdown')}
							title="Export as Markdown"
							class="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
						>
							.md
						</button>
						<button
							onclick={() => exportChat('json')}
							title="Export as JSON"
							class="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
						>
							.json
						</button>
					</div>
				{/if}
				{#if serverInfo?.status === 'ready' && serverInfo.modelName}
					<div
						class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
						<span class="max-w-48 truncate font-mono text-xs text-[var(--color-text-secondary)]">
							{serverInfo.modelName}
						</span>
						{#if serverInfo.lastTokensPerSecond != null}
							<span class="font-mono text-xs text-[var(--color-accent)]">
								{serverInfo.lastTokensPerSecond.toFixed(1)} t/s
							</span>
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
			</div>
		</div>

		<!-- Main area -->
		<div class="flex min-h-0 flex-1">
			<!-- Left panel: File tree + Sessions -->
			<div
				class="flex w-[250px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)]"
			>
				<!-- File tree -->
				<div class="flex min-h-0 flex-1 flex-col">
					<div
						class="flex items-center justify-between border-b border-[var(--color-border)] px-2 py-1.5"
					>
						<span
							class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
						>
							Files
						</span>
						<button
							onclick={loadFiles}
							class="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
							title="Refresh"
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
									d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
								/>
							</svg>
						</button>
					</div>
					<div class="flex-1 overflow-y-auto px-1 py-1">
						<FileTree
							bind:this={fileTreeRef}
							{projectId}
							entries={fileEntries}
							{changedFiles}
							onFileSelect={handleFileSelect}
						/>
					</div>
				</div>

				<!-- Sessions -->
				<div
					class="flex max-h-[40%] shrink-0 flex-col border-t border-[var(--color-border)] px-1 py-2"
				>
					<SessionList
						bind:this={sessionListComponent}
						{projectId}
						{activeConversationId}
						modelId={serverInfo?.modelId ?? null}
						onSelect={selectConversation}
						onNew={newConversation}
					/>
				</div>
			</div>

			<!-- Right panel: Content area -->
			<div class="flex min-w-0 flex-1 flex-col">
				<!-- Tabs -->
				<div class="flex border-b border-[var(--color-border)]">
					<button
						onclick={() => (activeTab = 'chat')}
						class="border-b-2 px-4 py-2 text-xs font-medium transition-colors
							{activeTab === 'chat'
							? 'border-[var(--color-accent)] text-[var(--color-accent)]'
							: 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
					>
						Chat
					</button>
					<button
						onclick={() => (activeTab = 'files')}
						class="border-b-2 px-4 py-2 text-xs font-medium transition-colors
							{activeTab === 'files'
							? 'border-[var(--color-accent)] text-[var(--color-accent)]'
							: 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
					>
						Files
						{#if selectedFilePath}
							<span class="ml-1 text-[var(--color-text-muted)]">
								- {selectedFilePath.split('/').pop()}
							</span>
						{/if}
					</button>
				</div>

				<!-- Tab content -->
				{#if activeTab === 'chat'}
					<ChatPanel
						bind:this={chatPanelRef}
						bind:messages
						bind:input
						bind:streaming
						{activeConversationId}
						{serverInfo}
						{tokenUsage}
						collapsibleThinking={false}
						showApprovals={true}
						disabled={streaming || serverInfo?.status !== 'ready'}
						placeholder={serverInfo?.status === 'ready' ? 'Message...' : 'Load a model first...'}
						onsend={sendMessage}
						onstop={stopGeneration}
						onapproval={handleApproval}
						onallowpath={handleAllowPath}
						ondismisssandbox={handleDismissSandbox}
						onsaveEdit={handleSaveEdit}
					>
						{#snippet inputSuffix()}
							<div class="mx-auto mt-2 max-w-3xl">
								<button
									onclick={() => (reasoningOpen = !reasoningOpen)}
									class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
								>
									<svg
										class="h-3 w-3 transition-transform {reasoningOpen ? 'rotate-90' : ''}"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
									</svg>
									Reasoning
									{#if thinkingBudgetEnabled}
										<span class="font-mono text-[var(--color-accent)]">
											{thinkingBudgetValue.toLocaleString()}
										</span>
									{/if}
								</button>
								{#if reasoningOpen}
									<div
										class="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2"
									>
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
													min={1024}
													max={32768}
													step={256}
													class="sampling-range flex-1"
												/>
											{:else}
												<span class="text-xs text-[var(--color-text-muted)]">Disabled</span>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/snippet}
					</ChatPanel>
				{:else}
					<!-- File preview -->
					<div class="min-h-0 flex-1 overflow-hidden">
						<FilePreview {projectId} filePath={selectedFilePath} />
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.workspace-container {
		margin: -1.25rem;
		margin-top: -3.5rem;
		height: 100vh;
	}

	@media (min-width: 768px) {
		.workspace-container {
			margin: -2rem;
			margin-top: -2rem;
		}
	}
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
