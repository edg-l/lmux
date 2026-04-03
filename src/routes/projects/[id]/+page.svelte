<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import ProjectSidebar from '$lib/components/ProjectSidebar.svelte';
	import ProjectTopBar from '$lib/components/ProjectTopBar.svelte';
	import type { Message, TokenUsage, Project } from '$lib/types/chat';
	import { processSSEStream } from '$lib/utils/stream';
	import {
		enrichToolMessages,
		exportChat as exportChatUtil,
		prepareMessagesForApi
	} from '$lib/utils/chat';
	import { getServerInfo, connectServerInfo } from '$lib/stores/server-info.svelte';
	import { fetchConversation as fetchConversationMessages } from '$lib/utils/conversations';
	import { fetchRecommendedSampling as fetchRecommendedSamplingApi } from '$lib/utils/sampling';

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

	// Process tracking
	let runningProcesses = $state<
		Array<{ id: string; command: string; startedAt: string; running: boolean }>
	>([]);

	// Memory state
	let memoryEnabled = $state(true);

	// Planning state
	let planEnabled = $state(true);
	let planText = $state('');
	let retrievalStatus = $state<string | null>(null);
	let planExplorationSteps = $state<Array<{ tool: string; summary: string; preview: string }>>([]);

	// Reasoning budget state
	let thinkingBudgetEnabled = $state(true);
	let thinkingBudgetValue = $state(32768);
	let thinkingBudget = $derived(thinkingBudgetEnabled ? thinkingBudgetValue : -1);

	// Auto-disable thinking if context is too small
	$effect(() => {
		const ctx = serverInfo?.contextSize;
		if (ctx && ctx < 32768) {
			thinkingBudgetEnabled = false;
		}
	});
	let reasoningOpen = $state(false);

	// Sampling state (coding defaults from Qwen3.5 recommendations)
	let temperature = $state(0.6);
	let top_p = $state(0.95);
	let top_k = $state(20);
	let min_p = $state(0.0);
	let repeat_penalty = $state(1.0);

	let fetchingRecommended = $state(false);

	async function fetchRecommendedSampling() {
		const modelId = serverInfo?.modelId;
		if (!modelId) return;
		fetchingRecommended = true;
		try {
			const result = await fetchRecommendedSamplingApi(modelId);
			if ('error' in result) return;
			temperature = result.temperature;
			top_p = result.top_p;
			top_k = result.top_k;
			min_p = result.min_p;
			repeat_penalty = result.repeat_penalty;
		} catch {
			// ignore
		} finally {
			fetchingRecommended = false;
		}
	}

	function resetSamplingDefaults() {
		temperature = 0.6;
		top_p = 0.95;
		top_k = 20;
		min_p = 0.0;
		repeat_penalty = 1.0;
	}

	async function fetchProcesses() {
		try {
			const res = await fetch(`/api/projects/${projectId}/processes`);
			if (res.ok) runningProcesses = await res.json();
		} catch {
			// ignore
		}
	}

	async function killProcess(id: string) {
		await fetch(`/api/projects/${projectId}/processes/${id}`, { method: 'DELETE' });
		await fetchProcesses();
	}

	// Component refs
	let fileTreeRef: FileTree | undefined = $state();
	let chatPanelRef: ChatPanel | undefined = $state();

	let cleanupServerInfo: (() => void) | null = null;

	async function loadMemoryEnabled() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const settings = await res.json();
				memoryEnabled = settings.memory_enabled !== 'false';
			}
		} catch {
			// default true
		}
	}

	onMount(() => {
		loadProject();
		loadFiles();
		loadGitStatus();
		fetchProcesses();
		loadMemoryEnabled();
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
		planText = '';
		retrievalStatus = null;
		changedFiles = new Map();
		activeTab = 'chat';
		try {
			const rawMessages = await fetchConversationMessages(id);
			messages = enrichToolMessages(rawMessages);
		} catch {
			messages = [];
		}
	}

	async function newConversation() {
		activeConversationId = null;
		messages = [];
		input = '';
		planText = '';
		tokenUsage = null;
		changedFiles = new Map();
		activeTab = 'chat';
	}

	async function deleteConversation(id: number) {
		try {
			await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
			if (activeConversationId === id) {
				activeConversationId = null;
				messages = [];
				input = '';
				planText = '';
				retrievalStatus = null;
				tokenUsage = null;
			}
			sessionListComponent?.loadConversations();
		} catch {
			// ignore
		}
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
		opts?: {
			toolCallId?: string;
			toolCalls?: string;
			tokenCount?: number;
			plan?: string;
			images?: Array<{ name: string; dataUrl: string }>;
		}
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
					...(opts?.tokenCount != null && { tokenCount: opts.tokenCount }),
					...(opts?.plan && { plan: opts.plan }),
					...(opts?.images && { images: JSON.stringify(opts.images) })
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

		planText = '';
		planExplorationSteps = [];
		retrievalStatus = null;
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
						temperature,
						top_p,
						top_k,
						min_p,
						repeat_penalty,
						thinking_budget: thinkingBudget
					},
					tools_enabled: true,
					memory_enabled: memoryEnabled,
					model_id: serverInfo?.modelId ?? null,
					project_id: projectId,
					plan_enabled: planEnabled
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
				onToolResult: (id, content, statusIdx, error, images) => {
					if (statusIdx !== undefined) {
						messages = messages.map((m, i) =>
							i === statusIdx
								? { ...m, content, toolStatus: 'done' as const, toolError: error, images }
								: m
						);
					}
					// Add assistant placeholder so thinking dots show while model processes
					messages = [...messages, { role: 'assistant', content: '' }];
					// Refresh process list after any tool result
					fetchProcesses();
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
				onRetrievalStatus: (status) => {
					retrievalStatus = status === 'done' ? null : status;
					if (status === 'searching') {
						messages = messages.map((m, i) =>
							i === messages.length - 1 && m.role === 'assistant'
								? { ...m, content: '*Searching codebase for relevant context...*' }
								: m
						);
					} else if (status === 'exploring') {
						messages = messages.map((m, i) =>
							i === messages.length - 1 && m.role === 'assistant'
								? { ...m, content: '*Exploring codebase for planning...*' }
								: m
						);
					} else if (status === 'planning') {
						messages = messages.map((m, i) =>
							i === messages.length - 1 && m.role === 'assistant'
								? { ...m, content: '*Generating plan...*' }
								: m
						);
					} else if (status === 'done') {
						messages = messages.map((m, i) =>
							i === messages.length - 1 && m.role === 'assistant' ? { ...m, content: '' } : m
						);
					}
				},
				onPlanningToolCall: (toolName, toolArgs, resultPreview) => {
					let summary = `${toolName}`;
					try {
						const args = JSON.parse(toolArgs);
						if (toolName === 'read_file' && args.path) {
							summary = `Read ${args.path}`;
						} else if (toolName === 'search_files' && args.pattern) {
							summary = `Searched for "${args.pattern}"`;
						} else if (toolName === 'list_directory') {
							summary = `Listed ${args.path || '/'}`;
						}
					} catch {
						// Use default summary
					}
					planExplorationSteps = [
						...planExplorationSteps,
						{ tool: toolName, summary, preview: resultPreview }
					];
					messages = messages.map((m, i) =>
						i === messages.length - 1 && m.role === 'assistant'
							? { ...m, content: `*Planning: ${summary}...*` }
							: m
					);
				},
				onPlanDelta: (content) => {
					planText += content;
				},
				onPlanDone: (content) => {
					planText = content;
					// Store plan text on the current assistant message
					messages = messages.map((m, i) =>
						i === messages.length - 1 && m.role === 'assistant' ? { ...m, plan: content } : m
					);
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
					toolCallId: tm.toolCallId,
					images: tm.images
				});
			}

			const lastMsg = messages[messages.length - 1];
			if (lastMsg?.role === 'assistant') {
				await saveMessage(conversationId, 'assistant', lastMsg.content || '', {
					...(lastMsg.plan && { plan: lastMsg.plan })
				});
			}
		} catch (err) {
			console.error('Chat error:', err);
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
		<ProjectTopBar
			{project}
			{serverInfo}
			{messages}
			onexport={(format) => exportChat(format === 'md' ? 'markdown' : 'json')}
		/>

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
					class="flex max-h-[40%] min-h-0 shrink-0 flex-col overflow-hidden border-t border-[var(--color-border)] px-1 py-2"
				>
					<SessionList
						bind:this={sessionListComponent}
						{projectId}
						{activeConversationId}
						modelId={serverInfo?.modelId ?? null}
						onSelect={selectConversation}
						onNew={newConversation}
						onDelete={deleteConversation}
					/>
				</div>
			</div>

			<!-- Center panel: Content area -->
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
						collapsibleThinking={true}
						showApprovals={true}
						explorationSteps={planExplorationSteps}
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
							<div class="mt-2 flex items-center gap-3 xl:hidden">
								<button
									onclick={() => (planEnabled = !planEnabled)}
									class="flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors {planEnabled
										? 'bg-[var(--color-accent-subtle,var(--color-surface))] text-[var(--color-accent)]'
										: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
									title={planEnabled ? 'Planning enabled' : 'Planning disabled'}
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
											d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
										/>
									</svg>
									Plan
								</button>
								<button
									onclick={() => (memoryEnabled = !memoryEnabled)}
									class="flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors {memoryEnabled
										? 'bg-[var(--color-accent-subtle,var(--color-surface))] text-[var(--color-accent)]'
										: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
									title={memoryEnabled ? 'Memory enabled' : 'Memory disabled'}
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
											d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
										/>
									</svg>
									Memory
								</button>
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

			<!-- Right panel: Controls (chat tab only, wide screens) -->
			{#if activeTab === 'chat'}
				<ProjectSidebar
					bind:planEnabled
					bind:memoryEnabled
					bind:thinkingBudgetEnabled
					bind:thinkingBudgetValue
					bind:temperature
					bind:topP={top_p}
					bind:topK={top_k}
					bind:minP={min_p}
					bind:repeatPenalty={repeat_penalty}
					{runningProcesses}
					{fetchingRecommended}
					{serverInfo}
					onfetchrecommended={fetchRecommendedSampling}
					onresetsampling={resetSamplingDefaults}
					onkillprocess={killProcess}
				/>
			{/if}
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
</style>
