<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import ChatSidebar from '$lib/components/ChatSidebar.svelte';
	import SamplingPanel from '$lib/components/SamplingPanel.svelte';
	import SystemPromptPanel from '$lib/components/SystemPromptPanel.svelte';
	import type { Message } from '$lib/types/chat';
	import { processSSEStream } from '$lib/utils/stream';
	import {
		enrichToolMessages,
		exportChat as exportChatUtil,
		prepareMessagesForApi
	} from '$lib/utils/chat';
	import {
		getServerInfo,
		getServerLogs,
		connectServerInfo
	} from '$lib/stores/server-info.svelte';

	interface Conversation {
		id: number;
		title: string | null;
		model_id: number | null;
		model_name: string | null;
		tags: string;
		created_at: string;
		updated_at: string;
	}

	interface AvailableModel {
		id: number;
		filename: string;
	}

	interface SamplingParams {
		temperature: number;
		top_p: number;
		top_k: number;
		min_p: number;
		repeat_penalty: number;
	}

	const SAMPLING_DEFAULTS: SamplingParams = {
		temperature: 0.7,
		top_p: 0.95,
		top_k: 40,
		min_p: 0.05,
		repeat_penalty: 1.1
	};

	let conversations = $state<Conversation[]>([]);
	let activeConversationId: number | null = $state(null);
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let abortController: AbortController | null = $state(null);
	let chatPanelRef: ChatPanel | undefined = $state();
	let confirmDeleteId: number | null = $state(null);
	let sidebarOpen = $state(true);

	// Server/model info (from shared store)
	let serverInfo = $derived(getServerInfo());
	let serverLogs = $derived(getServerLogs());

	// Sampling panel state
	let samplingOpen = $state(false);
	let systemPromptOpen = $state(false);
	let modelSystemPrompt: string | null = $state(null);
	let temperature = $state(SAMPLING_DEFAULTS.temperature);
	let top_p = $state(SAMPLING_DEFAULTS.top_p);
	let top_k = $state(SAMPLING_DEFAULTS.top_k);
	let min_p = $state(SAMPLING_DEFAULTS.min_p);
	let repeat_penalty = $state(SAMPLING_DEFAULTS.repeat_penalty);
	let samplingSource = $state('default');
	let samplingModelId: number | null = $state(null);

	// Token usage tracking
	let tokenUsage: { prompt: number; completion: number; total: number } | null = $state(null);

	// Model selection state
	let availableModels = $state<AvailableModel[]>([]);
	let selectedModelId: number | null = $state(null);
	let isLaunching = $state(false);
	let modelError = $state('');

	// Tool calling state
	let toolsEnabled = $state(true);

	// Feature 1: Conversation search
	let searchQuery = $state('');
	let filteredConversations = $derived.by(() => {
		let result = conversations;
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			result = result.filter((c) => (c.title ?? '').toLowerCase().includes(q));
		}
		if (activeTag) {
			const tag = activeTag;
			result = result.filter((c) => {
				const tags = (c.tags ?? '')
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean);
				return tags.includes(tag);
			});
		}
		return result;
	});

	// Feature 2: Export chat
	let exportOpen = $state(false);

	// Feature 6: Reasoning budget
	let thinkingBudgetEnabled = $state(false);
	let thinkingBudgetValue = $state(4096);
	let thinkingBudget = $derived(thinkingBudgetEnabled ? thinkingBudgetValue : -1);

	// Feature 7: Image/Vision support
	let pendingImages = $state<Array<{ name: string; base64: string; dataUrl: string }>>([]);
	let imageInputEl: HTMLInputElement | undefined = $state();

	// Feature 9: Server logs panel
	let logsOpen = $state(false);
	let logsContainer: HTMLDivElement | undefined = $state();

	// Feature 10: Conversation tags
	let editingTagsConvId: number | null = $state(null);
	let tagInput = $state('');
	let activeTag: string | null = $state(null);

	// Toolbar overflow menu

	// Feature 11: Prompt presets
	interface PresetInfo {
		id: number;
		name: string;
		system_prompt: string | null;
		temperature: number | null;
		top_p: number | null;
		top_k: number | null;
		min_p: number | null;
		repeat_penalty: number | null;
		thinking_budget: number | null;
	}
	let presets = $state<PresetInfo[]>([]);
	let presetDropdownOpen = $state(false);
	let savePresetOpen = $state(false);
	let savePresetName = $state('');

	function handleImageSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files) return;
		for (const file of Array.from(input.files)) {
			if (file.size > 10 * 1024 * 1024) continue; // Skip files > 10MB
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result as string;
				const base64 = dataUrl.split(',')[1];
				pendingImages = [...pendingImages, { name: file.name, base64, dataUrl }];
			};
			reader.readAsDataURL(file);
		}
		// Reset input so same file can be selected again
		input.value = '';
	}

	function removeImage(index: number) {
		pendingImages = pendingImages.filter((_, i) => i !== index);
	}

	// Feature 3: Token counter
	let inputTokenEstimate = $derived(Math.ceil(input.length / 4));

	onMount(() => {
		loadConversations();
		loadToolsEnabled();
		loadAvailableModels();
		loadPresets();
		const cleanupServerInfo = connectServerInfo();
		document.addEventListener('keydown', handleGlobalKeydown);
		return () => {
			cleanupServerInfo();
			document.removeEventListener('keydown', handleGlobalKeydown);
		};
	});

	// Auto-load sampling params when model changes
	$effect(() => {
		if (serverInfo?.modelId && serverInfo.modelId !== samplingModelId) {
			samplingModelId = serverInfo.modelId;
			loadSamplingParams(serverInfo.modelId);
		}
	});

	async function loadAvailableModels() {
		try {
			const res = await fetch('/api/models');
			if (res.ok) {
				const models = await res.json();
				availableModels = models.map((m: { id: number; filename: string }) => ({
					id: m.id,
					filename: m.filename
				}));
			}
		} catch {
			// ignore
		}
	}

	async function loadToolsEnabled() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const settings = await res.json();
				toolsEnabled = settings.tools_enabled !== 'false';
			}
		} catch {
			// default true
		}
	}

	async function toggleTools() {
		toolsEnabled = !toolsEnabled;
		try {
			await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key: 'tools_enabled', value: toolsEnabled ? 'true' : 'false' })
			});
		} catch {
			// revert on failure
			toolsEnabled = !toolsEnabled;
		}
	}


	async function loadSamplingParams(modelId: number) {
		try {
			const res = await fetch(`/api/models/${modelId}/sampling`);
			if (!res.ok) return;
			const params = await res.json();
			temperature = params.temperature;
			top_p = params.top_p;
			top_k = params.top_k;
			min_p = params.min_p;
			repeat_penalty = params.repeat_penalty;
			samplingSource = params.source;
		} catch {
			// defaults
		}
		try {
			const spRes = await fetch(`/api/models/${modelId}/system-prompt`);
			if (spRes.ok) {
				const spData = await spRes.json();
				modelSystemPrompt = spData.system_prompt;
			}
		} catch {
			// ignore
		}
	}

	async function saveSamplingDefaults() {
		if (!samplingModelId) return;
		try {
			await fetch(`/api/models/${samplingModelId}/sampling`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ temperature, top_p, top_k, min_p, repeat_penalty })
			});
			samplingSource = 'user';
		} catch {
			/* ignore */
		}
	}

	let fetchingRecommended = $state(false);

	async function fetchRecommendedSampling() {
		if (!samplingModelId) return;
		fetchingRecommended = true;
		try {
			const res = await fetch(`/api/models/${samplingModelId}/sampling`, { method: 'POST' });
			if (!res.ok) {
				const data = await res.json();
				modelError = data.error ?? 'Failed to fetch recommended params';
				return;
			}
			const params = await res.json();
			temperature = params.temperature;
			top_p = params.top_p;
			top_k = params.top_k;
			min_p = params.min_p;
			repeat_penalty = params.repeat_penalty;
			samplingSource = params.source;
		} catch {
			modelError = 'Failed to fetch recommended params';
		} finally {
			fetchingRecommended = false;
		}
	}

	function resetSampling() {
		temperature = SAMPLING_DEFAULTS.temperature;
		top_p = SAMPLING_DEFAULTS.top_p;
		top_k = SAMPLING_DEFAULTS.top_k;
		min_p = SAMPLING_DEFAULTS.min_p;
		repeat_penalty = SAMPLING_DEFAULTS.repeat_penalty;
		samplingSource = 'default';
	}

	async function loadConversations() {
		try {
			const res = await fetch('/api/conversations');
			if (res.ok) conversations = await res.json();
		} catch {
			/* ignore */
		}
	}

	async function newConversation() {
		activeConversationId = null;
		messages = [];
		input = '';
		modelError = '';
		selectedModelId = serverInfo?.modelId ?? null;
	}

	async function selectConversation(id: number) {
		activeConversationId = id;
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

	async function deleteConversation(id: number) {
		await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
		conversations = conversations.filter((c) => c.id !== id);
		if (activeConversationId === id) {
			activeConversationId = null;
			messages = [];
		}
		confirmDeleteId = null;
	}

	async function ensureConversation(): Promise<number> {
		if (activeConversationId) return activeConversationId;

		const modelId = selectedModelId ?? serverInfo?.modelId ?? null;
		if (!modelId) {
			modelError = 'Select a model first';
			throw new Error('No model selected');
		}
		modelError = '';

		const title = input.trim().slice(0, 50) || 'New conversation';
		const res = await fetch('/api/conversations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, modelId })
		});
		const data = await res.json();
		activeConversationId = data.id;
		await loadConversations();
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
					...(opts?.images && { images: JSON.stringify(opts.images) })
				})
			});
			if (res.ok) {
				const data = await res.json();
				return data.id;
			}
		} catch {
			// ignore save failures
		}
		return null;
	}

	async function sendMessage() {
		const text = input.trim();
		if ((!text && pendingImages.length === 0) || streaming) return;

		const previousActiveId = activeConversationId;
		let conversationId: number;
		try {
			conversationId = await ensureConversation();
		} catch {
			return;
		}

		// Get the conversation's model_id (may have just been created)
		const wasNew = conversationId !== previousActiveId;
		const conv = conversations.find((c) => c.id === conversationId);
		const convModelId = conv?.model_id ?? null;

		// Auto-assign model to legacy conversations without one (Task 6.3)
		// Skip for newly-created conversations (they already have a model_id from ensureConversation)
		if (!wasNew && convModelId === null && serverInfo?.modelId) {
			try {
				await fetch(`/api/conversations/${conversationId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ model_id: serverInfo.modelId })
				});
				await loadConversations();
			} catch {
				// non-fatal
			}
		} else if (convModelId !== null && serverInfo?.modelId !== convModelId) {
			// Task 6.1: Wrong model running
			modelError = 'Wrong model is running. Launch the correct model first.';
			return;
		}
		const images = [...pendingImages];
		pendingImages = [];

		// Build user message content: string if no images, multimodal array if images
		let userContent: string | Array<Record<string, unknown>>;
		if (images.length > 0) {
			userContent = [
				{ type: 'text', text },
				...images.map((img) => ({
					type: 'image_url',
					image_url: { url: img.dataUrl }
				}))
			];
		} else {
			userContent = text;
		}

		messages = [
			...messages,
			{
				role: 'user',
				content: typeof userContent === 'string' ? userContent : text,
				images: images.length > 0 ? images : undefined
			} as Message
		];
		input = '';
		await saveMessage(conversationId, 'user', text, images.length > 0 ? { images } : undefined);
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
						temperature,
						top_p,
						top_k,
						min_p,
						repeat_penalty,
						thinking_budget: thinkingBudget
					},
					tools_enabled: toolsEnabled,
					model_id: serverInfo?.modelId ?? null
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
					// Add a new assistant placeholder for the next response
					messages = [...messages, { role: 'assistant', content: '' }];
				},
				getAssistantContent: (toolCallCount) => {
					const lastAssistant = messages[messages.length - toolCallCount - 1];
					return lastAssistant?.role === 'assistant' ? lastAssistant.content : '';
				},
				onUsage: (usage) => {
					tokenUsage = usage;
				},
				getMessageCount: () => messages.length
			});

			// Persist tool messages
			for (const tm of pendingToolMessages) {
				await saveMessage(conversationId, tm.role, tm.content, {
					toolCalls: tm.toolCalls,
					toolCallId: tm.toolCallId
				});
			}

			// Persist final assistant message
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
			tick().then(() => chatPanelRef?.focusTextarea());
		}
	}

	function stopGeneration() {
		abortController?.abort();
	}

	let activeConversation = $derived(
		conversations.find((c) => c.id === activeConversationId) ?? null
	);

	let modelMismatch = $derived.by(() => {
		if (!activeConversation || activeConversation.model_id === null) return false;
		return serverInfo?.modelId !== activeConversation.model_id;
	});

	let modelDeleted = $derived.by(() => {
		if (!activeConversation) return false;
		return activeConversation.model_id === null && activeConversationId !== null;
	});

	// Task 4.5: Auto-clear isLaunching when the right model is ready
	$effect(() => {
		if (
			isLaunching &&
			serverInfo?.status === 'ready' &&
			activeConversation?.model_id &&
			serverInfo.modelId === activeConversation.model_id
		) {
			isLaunching = false;
		}
	});

	async function launchModel(modelId: number) {
		isLaunching = true;
		modelError = '';
		try {
			// Fetch profiles for the model
			const profilesRes = await fetch(`/api/models/${modelId}/profiles`);
			if (!profilesRes.ok) {
				modelError = 'Failed to load model profiles';
				isLaunching = false;
				return;
			}
			const profiles = await profilesRes.json();
			if (!profiles || profiles.length === 0) {
				modelError = 'No profiles found for this model. Create one on the models page.';
				isLaunching = false;
				return;
			}

			// If a different model is running, stop it first
			if (serverInfo?.status === 'ready' || serverInfo?.status === 'starting') {
				const currentModelName = serverInfo.modelName ?? 'current model';
				const targetModel = availableModels.find((m) => m.id === modelId);
				const targetName = targetModel?.filename ?? 'selected model';
				if (!confirm(`Stop ${currentModelName} and launch ${targetName}?`)) {
					isLaunching = false;
					return;
				}
				await fetch('/api/server/stop', { method: 'POST' });
				// Wait for stop to complete (10s timeout)
				await new Promise<void>((resolve, reject) => {
					const deadline = Date.now() + 10_000;
					const check = setInterval(() => {
						if (!serverInfo || serverInfo.status === 'stopped' || serverInfo.status === 'error') {
							clearInterval(check);
							resolve();
						} else if (Date.now() > deadline) {
							clearInterval(check);
							reject(new Error('Timed out waiting for server to stop'));
						}
					}, 200);
				});
			}

			const startRes = await fetch('/api/server/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ modelId, profileId: profiles[0].id })
			});
			if (!startRes.ok) {
				const err = await startRes.json();
				modelError = err.error ?? 'Failed to start server';
				isLaunching = false;
			}
		} catch {
			modelError = 'Failed to launch model';
			isLaunching = false;
		}
	}

	function exportChat(format: 'markdown' | 'json') {
		if (!activeConversation) return;
		exportChatUtil(messages, activeConversationId, format);
		exportOpen = false;
	}

	async function handleSaveEdit(idx: number, newContent: string) {
		const msg = messages[idx];
		if (!msg?.id || !activeConversationId) return;

		await fetch(`/api/conversations/${activeConversationId}/messages`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromMessageId: msg.id })
		});

		messages = messages.slice(0, idx);
		input = newContent;
		sendMessage();
	}

	// Auto-scroll logs to bottom
	$effect(() => {
		if (logsContainer && serverLogs.length > 0) {
			serverLogs[serverLogs.length - 1];
			requestAnimationFrame(() => {
				if (logsContainer) logsContainer.scrollTop = logsContainer.scrollHeight;
			});
		}
	});

	// Unique tags across all conversations
	let allTags = $derived.by(() => {
		const tagSet = new Set<string>();
		for (const c of conversations) {
			const tags = (c.tags ?? '')
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			for (const t of tags) tagSet.add(t);
		}
		return [...tagSet].sort();
	});

	async function saveConversationTags(convId: number, tags: string) {
		try {
			await fetch(`/api/conversations/${convId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tags })
			});
			conversations = conversations.map((c) => (c.id === convId ? { ...c, tags } : c));
		} catch {
			// ignore
		}
	}

	function startEditingTags(conv: Conversation) {
		editingTagsConvId = conv.id;
		tagInput = conv.tags ?? '';
	}

	function finishEditingTags() {
		if (editingTagsConvId !== null) {
			saveConversationTags(editingTagsConvId, tagInput);
			editingTagsConvId = null;
			tagInput = '';
		}
	}

	async function loadPresets() {
		try {
			const res = await fetch('/api/presets');
			if (res.ok) presets = await res.json();
		} catch {
			// ignore
		}
	}

	function applyPreset(preset: PresetInfo) {
		if (preset.temperature != null) temperature = preset.temperature;
		if (preset.top_p != null) top_p = preset.top_p;
		if (preset.top_k != null) top_k = preset.top_k;
		if (preset.min_p != null) min_p = preset.min_p;
		if (preset.repeat_penalty != null) repeat_penalty = preset.repeat_penalty;
		if (preset.thinking_budget != null) {
			if (preset.thinking_budget >= 0) {
				thinkingBudgetEnabled = true;
				thinkingBudgetValue = preset.thinking_budget;
			} else {
				thinkingBudgetEnabled = false;
			}
		}
		if (preset.system_prompt != null) modelSystemPrompt = preset.system_prompt;
		presetDropdownOpen = false;
	}

	async function saveAsPreset() {
		const name = savePresetName.trim();
		if (!name) return;
		try {
			await fetch('/api/presets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					system_prompt: modelSystemPrompt,
					temperature,
					top_p,
					top_k,
					min_p,
					repeat_penalty,
					thinking_budget: thinkingBudget
				})
			});
			await loadPresets();
			savePresetOpen = false;
			savePresetName = '';
		} catch {
			// ignore
		}
	}

	async function deletePresetById(id: number) {
		try {
			await fetch(`/api/presets/${id}`, { method: 'DELETE' });
			await loadPresets();
		} catch {
			// ignore
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.ctrlKey && !e.shiftKey && e.key === 'n') {
			e.preventDefault();
			newConversation();
		} else if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
			e.preventDefault();
			fetch('/api/server/stop', { method: 'POST' });
		} else if (e.key === 'Escape' && streaming) {
			e.preventDefault();
			stopGeneration();
		}
	}
</script>

<div class="-m-5 flex h-screen md:-m-8">
	<!-- Conversation sidebar -->
	{#if sidebarOpen}
		<ChatSidebar
			{filteredConversations}
			{activeConversationId}
			bind:searchQuery
			{allTags}
			bind:activeTag
			bind:editingTagsConvId
			bind:tagInput
			bind:confirmDeleteId
			{serverInfo}
			onNewConversation={newConversation}
			onSelectConversation={selectConversation}
			onDeleteConversation={deleteConversation}
			onStartEditingTags={startEditingTags}
			onFinishEditingTags={finishEditingTags}
			onSetActiveTag={(tag) => (activeTag = tag)}
			onSetConfirmDeleteId={(id) => (confirmDeleteId = id)}
		/>
	{/if}

	<!-- Chat area -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header -->
		<div class="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
			<button
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
				aria-label="Toggle conversations"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
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
						onclick={() => (exportOpen = !exportOpen)}
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
								onclick={() => exportChat('markdown')}
								class="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
								>Export MD</button
							>
							<button
								onclick={() => exportChat('json')}
								class="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
								>Export JSON</button
							>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Tools toggle (wrench icon) -->
			<button
				onclick={toggleTools}
				class="rounded p-1.5 transition-colors {toolsEnabled
					? 'text-[var(--color-accent)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				title={toolsEnabled ? 'Tools enabled' : 'Tools disabled'}
			>
				<svg
					class="h-5 w-5"
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
			</button>

			<!-- Sampling toggle -->
			<button
				onclick={() => (samplingOpen = !samplingOpen)}
				class="rounded p-1.5 transition-colors {samplingOpen
					? 'text-[var(--color-accent)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				title="Sampling parameters"
			>
				<svg
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
					/>
				</svg>
			</button>

			<!-- System prompt toggle -->
			<button
				onclick={() => (systemPromptOpen = !systemPromptOpen)}
				class="rounded p-1.5 transition-colors {systemPromptOpen
					? 'text-[var(--color-accent)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				title="System prompt"
			>
				<svg
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
					/>
				</svg>
			</button>

			<!-- Server logs toggle -->
			<button
				onclick={() => (logsOpen = !logsOpen)}
				class="rounded p-1.5 transition-colors {logsOpen
					? 'text-[var(--color-accent)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
				title="Server logs"
			>
				<svg
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
					/>
				</svg>
			</button>
		</div>

		<!-- Server Logs panel -->
		{#if logsOpen}
			<div class="border-b border-[var(--color-border)] bg-[#0d1117] px-4 py-2">
				<div class="mb-1 flex items-center justify-between">
					<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
						>Server Logs</span
					>
					<span class="font-mono text-xs text-[var(--color-text-muted)]"
						>{serverLogs.length} lines</span
					>
				</div>
				<div
					bind:this={logsContainer}
					class="max-h-48 overflow-y-auto rounded border border-[var(--color-border)] bg-[#010409] p-2"
				>
					{#if serverLogs.length === 0}
						<p class="font-mono text-xs text-[var(--color-text-muted)]">No logs yet</p>
					{:else}
						{#each serverLogs as line}
							<p class="font-mono text-xs leading-5 text-green-400/80">{line}</p>
						{/each}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Sampling panel -->
		{#if samplingOpen}
			<SamplingPanel
				bind:temperature
				bind:top_p
				bind:top_k
				bind:min_p
				bind:repeat_penalty
				{samplingSource}
				{samplingModelId}
				{fetchingRecommended}
				bind:thinkingBudgetEnabled
				bind:thinkingBudgetValue
				{presets}
				bind:presetDropdownOpen
				bind:savePresetOpen
				bind:savePresetName
				onFetchRecommended={fetchRecommendedSampling}
				onReset={resetSampling}
				onSave={saveSamplingDefaults}
				onApplyPreset={applyPreset}
				onDeletePreset={deletePresetById}
				onSaveAsPreset={saveAsPreset}
			/>
		{/if}

		<!-- System Prompt panel -->
		{#if systemPromptOpen}
			<SystemPromptPanel bind:modelSystemPrompt {samplingModelId} />
		{/if}

		<ChatPanel
			bind:this={chatPanelRef}
			bind:messages
			bind:input
			bind:streaming
			activeConversationId={activeConversation?.id ?? null}
			{serverInfo}
			{tokenUsage}
			collapsibleThinking={true}
			showApprovals={false}
			disabled={streaming || serverInfo?.status !== 'ready' || modelMismatch || modelDeleted}
			placeholder={serverInfo?.status === 'ready'
				? 'Message...'
				: serverInfo?.status === 'starting'
					? 'Loading model...'
					: 'Load a model first...'}
			hasAttachments={pendingImages.length > 0}
			onsend={sendMessage}
			onstop={stopGeneration}
			onsaveEdit={handleSaveEdit}
		>
			{#snippet inputHeader()}
				{#if modelDeleted}
					<div class="mx-auto flex max-w-3xl flex-col items-center gap-2 py-4">
						<p class="text-sm text-red-400">This conversation's model has been removed.</p>
						<a
							href="/models"
							class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/30"
						>
							Go to Models
						</a>
					</div>
				{:else if modelMismatch && activeConversation?.model_id}
					<div class="mx-auto flex max-w-3xl flex-col items-center gap-2 py-4">
						<p class="text-sm text-[var(--color-text-muted)]">
							This conversation uses
							<span class="font-mono text-[var(--color-text-secondary)]"
								>{activeConversation.model_name}</span
							>
						</p>
						<button
							onclick={() => launchModel(activeConversation!.model_id!)}
							disabled={isLaunching}
							class="rounded-lg bg-[var(--color-accent-dim)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
						>
							{#if isLaunching}
								Launching...
							{:else}
								Launch {activeConversation.model_name}
							{/if}
						</button>
						{#if modelError}
							<p class="text-xs text-red-400">{modelError}</p>
						{/if}
					</div>
				{:else if !activeConversationId}
					<div class="mx-auto mb-2 max-w-3xl">
						{#if availableModels.length > 0}
							<select
								bind:value={selectedModelId}
								class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
							>
								<option value={null}>Select a model...</option>
								{#each availableModels as model}
									<option value={model.id}>{model.filename}</option>
								{/each}
							</select>
						{:else}
							<p class="text-xs text-[var(--color-text-muted)]">
								No models found.
								<a href="/models/search" class="text-[var(--color-accent)] hover:underline"
									>Add a model</a
								>
							</p>
						{/if}
						{#if modelError}
							<p class="mt-1 text-xs text-red-400">{modelError}</p>
						{/if}
					</div>
				{/if}
			{/snippet}
			{#snippet inputPrefix()}
				<input
					bind:this={imageInputEl}
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					onchange={handleImageSelect}
				/>
				{#if pendingImages.length > 0}
					<div class="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
						{#each pendingImages as img, i (img.name + i)}
							<div class="relative">
								<img
									src={img.dataUrl}
									alt={img.name}
									class="h-12 w-12 rounded-md border border-[var(--color-border)] object-cover"
								/>
								<button
									onclick={() => removeImage(i)}
									class="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-400"
									aria-label="Remove image">x</button
								>
							</div>
						{/each}
					</div>
				{/if}
				<button
					onclick={() => imageInputEl?.click()}
					disabled={streaming || serverInfo?.status !== 'ready'}
					class="shrink-0 self-end rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-2.5 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-text-secondary)] disabled:opacity-30"
					title="Attach images"
					aria-label="Attach images"
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
							d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
						/>
					</svg>
				</button>
			{/snippet}
			{#snippet inputSuffix()}
				{#if input.length > 0}
					<div class="mx-auto mt-1 max-w-3xl">
						<span class="font-mono text-xs text-[var(--color-text-muted)]"
							>~{inputTokenEstimate} tokens</span
						>
					</div>
				{/if}
			{/snippet}
		</ChatPanel>
	</div>
</div>
