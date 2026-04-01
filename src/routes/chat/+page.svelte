<script lang="ts">
	import { marked } from 'marked';
	import { markedHighlight } from 'marked-highlight';
	import DOMPurify from 'dompurify';
	import katex from 'katex';
	import hljs from 'highlight.js/lib/core';
	import javascript from 'highlight.js/lib/languages/javascript';
	import typescript from 'highlight.js/lib/languages/typescript';
	import python from 'highlight.js/lib/languages/python';
	import bash from 'highlight.js/lib/languages/bash';
	import json from 'highlight.js/lib/languages/json';
	import css from 'highlight.js/lib/languages/css';
	import xml from 'highlight.js/lib/languages/xml';
	import rust from 'highlight.js/lib/languages/rust';
	import cpp from 'highlight.js/lib/languages/cpp';
	import c from 'highlight.js/lib/languages/c';
	import java from 'highlight.js/lib/languages/java';
	import go from 'highlight.js/lib/languages/go';
	import sql from 'highlight.js/lib/languages/sql';
	import yaml from 'highlight.js/lib/languages/yaml';
	import markdown from 'highlight.js/lib/languages/markdown';
	import diff from 'highlight.js/lib/languages/diff';
	import 'highlight.js/styles/github-dark.css';
	import { onMount, tick } from 'svelte';

	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('js', javascript);
	hljs.registerLanguage('typescript', typescript);
	hljs.registerLanguage('ts', typescript);
	hljs.registerLanguage('python', python);
	hljs.registerLanguage('py', python);
	hljs.registerLanguage('bash', bash);
	hljs.registerLanguage('sh', bash);
	hljs.registerLanguage('shell', bash);
	hljs.registerLanguage('json', json);
	hljs.registerLanguage('css', css);
	hljs.registerLanguage('html', xml);
	hljs.registerLanguage('xml', xml);
	hljs.registerLanguage('rust', rust);
	hljs.registerLanguage('rs', rust);
	hljs.registerLanguage('cpp', cpp);
	hljs.registerLanguage('c', c);
	hljs.registerLanguage('java', java);
	hljs.registerLanguage('go', go);
	hljs.registerLanguage('sql', sql);
	hljs.registerLanguage('yaml', yaml);
	hljs.registerLanguage('yml', yaml);
	hljs.registerLanguage('markdown', markdown);
	hljs.registerLanguage('md', markdown);
	hljs.registerLanguage('diff', diff);

	marked.use(
		markedHighlight({
			langPrefix: 'hljs language-',
			highlight(code, lang) {
				if (lang && hljs.getLanguage(lang)) {
					return hljs.highlight(code, { language: lang }).value;
				}
				return code;
			}
		}),
		{
			renderer: {
				link({ href, text }) {
					return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
				},
				code({ text, lang }) {
					const trimmed = text.replace(/\n+$/, '');
					const rawLines = trimmed.replace(/<[^>]+>/g, '').split('\n');
					const nums = rawLines.map((_, i) => `<span>${i + 1}</span>`).join('\n');
					const langLabel = lang ? `<div class="code-lang">${lang}</div>` : '';
					return `<div class="code-block">${langLabel}<div class="code-body"><div class="line-numbers" aria-hidden="true">${nums}</div><pre class="code-content"><code class="hljs${lang ? ` language-${lang}` : ''}">${trimmed}</code></pre></div></div>`;
				}
			}
		}
	);

	interface ToolCallData {
		id: string;
		function: { name: string; arguments: string };
	}

	interface Message {
		id?: number;
		role: string;
		content: string;
		tool_calls?: ToolCallData[] | null;
		tool_call_id?: string | null;
		toolName?: string;
		toolArgs?: string;
		toolStatus?: 'running' | 'done';
		images?: Array<{ name: string; dataUrl: string; base64?: string }>;
	}

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

	interface ServerInfo {
		status: string;
		modelId: number | null;
		modelName: string | null;
		port: number;
		contextSize: number | null;
		lastTokensPerSecond: number | null;
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

	// Configure marked for safe rendering
	marked.setOptions({ breaks: true, gfm: true });

	let conversations = $state<Conversation[]>([]);
	let activeConversationId: number | null = $state(null);
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let abortController: AbortController | null = $state(null);
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let messagesContainer: HTMLDivElement | undefined = $state();
	let confirmDeleteId: number | null = $state(null);
	let sidebarOpen = $state(true);

	// Server/model info
	let serverInfo: ServerInfo | null = $state(null);

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

	// Thinking block expansion tracking (collapsed by default, set tracks *expanded* ones)
	let expandedThinking = $state<Set<number>>(new Set());

	// Model selection state
	let availableModels = $state<AvailableModel[]>([]);
	let selectedModelId: number | null = $state(null);
	let isLaunching = $state(false);
	let modelError = $state('');

	// Tool calling state
	let toolsEnabled = $state(true);
	let expandedTools = $state<Set<number>>(new Set());

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

	// Feature 5: Multi-turn editing
	let editingMessageIdx: number | null = $state(null);
	let editInput = $state('');

	// Feature 6: Reasoning budget
	let thinkingBudgetEnabled = $state(false);
	let thinkingBudgetValue = $state(4096);
	let thinkingBudget = $derived(thinkingBudgetEnabled ? thinkingBudgetValue : -1);

	// Feature 7: Image/Vision support
	let pendingImages = $state<Array<{ name: string; base64: string; dataUrl: string }>>([]);
	let imageInputEl: HTMLInputElement | undefined = $state();

	// Feature 9: Server logs panel
	let logsOpen = $state(false);
	let serverLogs = $state<string[]>([]);
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
		const cleanupServerInfo = loadServerInfo();
		document.addEventListener('keydown', handleGlobalKeydown);
		return () => {
			cleanupServerInfo();
			document.removeEventListener('keydown', handleGlobalKeydown);
		};
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

	/** Enrich tool messages loaded from DB with tool name/args from the preceding assistant's tool_calls */
	function enrichToolMessages(msgs: Message[]): Message[] {
		const toolCallMap = new Map<string, ToolCallData>();
		return msgs.map((msg) => {
			if (msg.role === 'assistant' && msg.tool_calls) {
				for (const tc of msg.tool_calls) {
					toolCallMap.set(tc.id, tc);
				}
			}
			if (msg.role === 'tool' && msg.tool_call_id) {
				const tc = toolCallMap.get(msg.tool_call_id);
				return {
					...msg,
					toolName: tc?.function.name ?? 'tool',
					toolArgs: tc?.function.arguments,
					toolStatus: 'done' as const
				};
			}
			return msg;
		});
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

	$effect(() => {
		if (messagesContainer && messages.length > 0) {
			messages[messages.length - 1]?.content;
			scrollToBottom();
		}
	});

	function scrollToBottom() {
		if (messagesContainer) {
			requestAnimationFrame(() => {
				if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	function loadServerInfo() {
		const es = new EventSource('/api/server/status');
		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				serverInfo = data;
				if (data.stderr && Array.isArray(data.stderr)) {
					serverLogs = data.stderr.slice(-100);
				}
				if (serverInfo?.modelId && serverInfo.modelId !== samplingModelId) {
					samplingModelId = serverInfo.modelId;
					loadSamplingParams(serverInfo.modelId);
				}
			} catch {
				/* ignore */
			}
		};
		// Keep listening for updates (model load, t/s changes)
		return () => es.close();
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

		// Track tool messages to persist after stream ends
		const pendingToolMessages: Array<{
			role: string;
			content: string;
			toolCalls?: string;
			toolCallId?: string;
		}> = [];
		// Map tool_call id to the index in messages array for status updates
		const toolStatusIndices = new Map<string, number>();

		try {
			const allowedRoles = new Set(['user', 'assistant', 'tool', 'system']);
			const chatMessages = messages
				.slice(0, -1) // exclude empty assistant placeholder
				.filter((m) => allowedRoles.has(m.role))
				.map((m) => {
					// Build multimodal content for messages with images
					let content: unknown = m.content;
					if (m.images && m.images.length > 0) {
						content = [
							{ type: 'text', text: m.content },
							...m.images.map((img) => ({
								type: 'image_url',
								image_url: { url: img.dataUrl }
							}))
						];
					}
					const msg: Record<string, unknown> = { role: m.role, content };
					if (m.tool_calls) msg.tool_calls = m.tool_calls;
					if (m.tool_call_id) {
						msg.role = 'tool';
						msg.tool_call_id = m.tool_call_id;
					}
					return msg;
				});

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

			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			// Track accumulated tool_calls for the current assistant message
			let currentToolCalls: ToolCallData[] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6).trim();
					if (data === '[DONE]') continue;
					try {
						const parsed = JSON.parse(data);

						if (parsed.type === 'delta') {
							messages = messages.map((m, i) =>
								i === messages.length - 1 ? { ...m, content: m.content + parsed.content } : m
							);
						} else if (parsed.type === 'tool_call') {
							const tc: ToolCallData = {
								id: parsed.id,
								function: { name: parsed.name, arguments: parsed.arguments }
							};
							currentToolCalls.push(tc);

							// Add a tool_status message for the UI
							const statusIdx = messages.length;
							toolStatusIndices.set(parsed.id, statusIdx);
							messages = [
								...messages,
								{
									role: 'tool_status',
									content: '',
									toolName: parsed.name,
									toolArgs: parsed.arguments,
									toolStatus: 'running',
									tool_call_id: parsed.id
								}
							];
						} else if (parsed.type === 'tool_result') {
							const statusIdx = toolStatusIndices.get(parsed.id);
							if (statusIdx !== undefined) {
								messages = messages.map((m, i) =>
									i === statusIdx
										? { ...m, content: parsed.content, toolStatus: 'done' as const }
										: m
								);
							}

							// Save the tool_calls assistant message if this is the first result
							// (all tool_calls were emitted before any tool_result)
							if (currentToolCalls.length > 0) {
								// Find the last real assistant message (not tool_status)
								const lastAssistant = messages[messages.length - currentToolCalls.length - 1];
								const assistantContent =
									lastAssistant?.role === 'assistant' ? lastAssistant.content : '';
								pendingToolMessages.push({
									role: 'assistant',
									content: assistantContent,
									toolCalls: JSON.stringify(currentToolCalls)
								});
								currentToolCalls = [];
							}

							pendingToolMessages.push({
								role: 'tool',
								content: parsed.content,
								toolCallId: parsed.id
							});

							// Add a new assistant placeholder for the next response
							messages = [...messages, { role: 'assistant', content: '' }];
						} else if (parsed.type === 'usage') {
							tokenUsage = {
								prompt: parsed.prompt_tokens ?? 0,
								completion: parsed.completion_tokens ?? 0,
								total: parsed.total_tokens ?? 0
							};
						}
					} catch {
						/* skip */
					}
				}
			}

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
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
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
			} else {
				messages = messages.map((m, i) =>
					i === messages.length - 1 ? { ...m, content: m.content || 'Error: Connection failed' } : m
				);
			}
		} finally {
			streaming = false;
			abortController = null;
			tick().then(() => textareaEl?.focus());
		}
	}

	function stopGeneration() {
		abortController?.abort();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

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

	/**
	 * Parse thinking blocks from content.
	 * Supports <think>...</think> tags used by some models (Qwen, DeepSeek).
	 * Returns array of { type: 'text' | 'thinking', content: string } segments.
	 */
	function parseThinking(content: string): Array<{ type: 'text' | 'thinking'; content: string }> {
		const segments: Array<{ type: 'text' | 'thinking'; content: string }> = [];
		const regex = /<think>([\s\S]*?)(<\/think>|$)/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(content)) !== null) {
			if (match.index > lastIndex) {
				const text = content.slice(lastIndex, match.index).trim();
				if (text) segments.push({ type: 'text', content: text });
			}
			// Always include thinking segment, even if empty (shows "Thinking..." during streaming)
			const thinkContent = match[1].trim();
			segments.push({ type: 'thinking', content: thinkContent || '...' });
			lastIndex = regex.lastIndex;
		}

		if (lastIndex < content.length) {
			const text = content.slice(lastIndex).trim();
			if (text) segments.push({ type: 'text', content: text });
		}

		// If no thinking tags found, return single text segment
		if (segments.length === 0 && content.trim()) {
			segments.push({ type: 'text', content: content.trim() });
		}

		return segments;
	}

	function renderMath(text: string): string {
		// Protect code blocks and inline code from math processing
		const codeBlocks: string[] = [];
		text = text.replace(/```[\s\S]*?```/g, (match) => {
			codeBlocks.push(match);
			return `\x00CODE${codeBlocks.length - 1}\x00`;
		});
		const inlineCodes: string[] = [];
		text = text.replace(/`[^`]+`/g, (match) => {
			inlineCodes.push(match);
			return `\x00INLINE${inlineCodes.length - 1}\x00`;
		});

		// Block math: $$...$$
		text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
			try {
				return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
			} catch {
				return `<pre class="math-error">${math}</pre>`;
			}
		});
		// Inline math: $...$
		text = text.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, math) => {
			try {
				return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
			} catch {
				return `<code>${math}</code>`;
			}
		});

		// Restore code blocks
		text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);
		text = text.replace(/\x00INLINE(\d+)\x00/g, (_, idx) => inlineCodes[parseInt(idx)]);
		return text;
	}

	function linkifyText(text: string): string {
		const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return escaped.replace(
			/(https?:\/\/[^\s<]+)/g,
			'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
		);
	}

	function renderMarkdown(text: string): string {
		const withMath = renderMath(text);
		const html = marked.parse(withMath, { async: false }) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: [
				'semantics',
				'annotation',
				'mrow',
				'mi',
				'mn',
				'mo',
				'msup',
				'msub',
				'mfrac',
				'mover',
				'munder',
				'msqrt',
				'mtext',
				'mspace',
				'mtable',
				'mtr',
				'mtd',
				'math'
			],
			ADD_ATTR: [
				'target',
				'rel',
				'xmlns',
				'mathvariant',
				'stretchy',
				'fence',
				'separator',
				'accent',
				'accentunder',
				'columnalign',
				'columnspacing',
				'rowspacing',
				'displaystyle',
				'scriptlevel',
				'encoding',
				'lspace',
				'rspace',
				'movablelimits',
				'symmetric'
			]
		});
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

	function toggleThinking(key: number) {
		const next = new Set(expandedThinking);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedThinking = next;
	}

	function exportChat(format: 'markdown' | 'json') {
		if (!activeConversation) return;
		const chatMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
		let content: string;
		let ext: string;
		let mimeType: string;

		if (format === 'markdown') {
			content = chatMessages
				.map((m) => `## ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`)
				.join('\n');
			ext = 'md';
			mimeType = 'text/markdown';
		} else {
			content = JSON.stringify(chatMessages, null, 2);
			ext = 'json';
			mimeType = 'application/json';
		}

		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `chat-${activeConversationId}-${Date.now()}.${ext}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		exportOpen = false;
	}

	async function saveEdit() {
		if (editingMessageIdx === null || !activeConversationId) return;
		const msg = messages[editingMessageIdx];
		if (!msg?.id) return;

		await fetch(`/api/conversations/${activeConversationId}/messages`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromMessageId: msg.id })
		});

		messages = messages.slice(0, editingMessageIdx);
		input = editInput;
		editingMessageIdx = null;
		editInput = '';
		sendMessage();
	}

	function cancelEdit() {
		editingMessageIdx = null;
		editInput = '';
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
		const target = e.target as HTMLElement;
		const tagName = target.tagName.toLowerCase();
		// Allow shortcuts from our chat textarea, but skip other inputs/textareas
		if ((tagName === 'input' || tagName === 'textarea') && target !== textareaEl) return;

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
	<div
		class="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)] {sidebarOpen
			? ''
			: 'hidden'}"
	>
		<div
			class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5"
		>
			<span class="text-xs font-medium text-[var(--color-text-muted)]">Conversations</span>
			<button
				onclick={newConversation}
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
						onclick={() => (activeTag = activeTag === tag ? null : tag)}
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
						onclick={() => selectConversation(conv.id)}
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
								onblur={finishEditingTags}
								onkeydown={(e) => {
									if (e.key === 'Enter') finishEditingTags();
								}}
								placeholder="tag1, tag2"
								class="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-[10px] text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
							/>
						</div>
					{:else if confirmDeleteId === conv.id}
						<button
							onclick={() => deleteConversation(conv.id)}
							class="mr-1 px-1.5 py-0.5 text-xs text-red-400">Yes</button
						>
						<button
							onclick={() => (confirmDeleteId = null)}
							class="mr-2 text-xs text-[var(--color-text-muted)]">No</button
						>
					{:else}
						<div class="mr-2 flex items-center gap-1 opacity-0 group-hover:opacity-100">
							<button
								onclick={(e) => {
									e.stopPropagation();
									startEditingTags(conv);
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
								onclick={() => (confirmDeleteId = conv.id)}
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
			<div class="border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4">
				<div class="mx-auto max-w-3xl">
					<div class="mb-4 flex items-center justify-between">
						<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
							>Sampling</span
						>
						<div class="flex items-center gap-2">
							<span
								class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-muted)]"
								>{samplingSource}</span
							>
							<button
								onclick={fetchRecommendedSampling}
								disabled={fetchingRecommended || !samplingModelId}
								class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
								>{fetchingRecommended ? 'Fetching...' : 'Fetch recommended'}</button
							>
							<button
								onclick={resetSampling}
								class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
								>Reset</button
							>
							<button
								onclick={saveSamplingDefaults}
								class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40"
								>Save</button
							>
							<span class="mx-1 text-[var(--color-border)]">|</span>
							<div class="relative">
								<button
									onclick={() => (presetDropdownOpen = !presetDropdownOpen)}
									class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
									>Presets</button
								>
								{#if presetDropdownOpen}
									<div
										class="absolute right-0 z-20 mt-1 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] py-1 shadow-lg"
									>
										{#if presets.length === 0}
											<p class="px-3 py-2 text-xs text-[var(--color-text-muted)]">No presets</p>
										{:else}
											{#each presets as preset}
												<div
													class="group/preset flex items-center justify-between px-3 py-1.5 hover:bg-[var(--color-surface)]"
												>
													<button
														onclick={() => applyPreset(preset)}
														class="flex-1 text-left text-xs text-[var(--color-text-secondary)]"
														>{preset.name}</button
													>
													<button
														onclick={() => deletePresetById(preset.id)}
														class="text-xs text-[var(--color-text-muted)] opacity-0 group-hover/preset:opacity-100 hover:text-red-400"
														>x</button
													>
												</div>
											{/each}
										{/if}
										<div class="border-t border-[var(--color-border)] px-3 pt-1.5 pb-1">
											{#if savePresetOpen}
												<div class="flex gap-1">
													<input
														type="text"
														bind:value={savePresetName}
														placeholder="Preset name"
														onkeydown={(e) => {
															if (e.key === 'Enter') saveAsPreset();
														}}
														class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
													/>
													<button
														onclick={saveAsPreset}
														class="rounded bg-[var(--color-accent-dim)] px-2 py-0.5 text-xs text-white hover:bg-[var(--color-accent)]"
														>OK</button
													>
												</div>
											{:else}
												<button
													onclick={() => (savePresetOpen = true)}
													class="w-full text-left text-xs text-[var(--color-accent)] hover:underline"
													>Save as Preset</button
												>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
					<div class="grid grid-cols-5 gap-4">
						{#each [{ label: 'Temperature', value: temperature, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (temperature = v) }, { label: 'Top P', value: top_p, min: 0, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (top_p = v) }, { label: 'Top K', value: top_k, min: 0, max: 200, step: 1, fmt: (v: number) => String(v), set: (v: number) => (top_k = v) }, { label: 'Min P', value: min_p, min: 0, max: 1, step: 0.01, fmt: (v: number) => v.toFixed(2), set: (v: number) => (min_p = v) }, { label: 'Repeat', value: repeat_penalty, min: 0.5, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), set: (v: number) => (repeat_penalty = v) }] as param}
							<div>
								<div class="mb-2 flex items-baseline justify-between">
									<span class="text-xs text-[var(--color-text-muted)]">{param.label}</span>
									<span class="font-mono text-xs font-medium text-[var(--color-text-primary)]"
										>{param.fmt(param.value)}</span
									>
								</div>
								<input
									type="range"
									value={param.value}
									oninput={(e) => param.set(parseFloat(e.currentTarget.value))}
									min={param.min}
									max={param.max}
									step={param.step}
									class="sampling-range w-full"
								/>
							</div>
						{/each}
					</div>
					<!-- Thinking Budget -->
					<div class="mt-4 border-t border-[var(--color-border)] pt-4">
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
									min={0}
									max={32768}
									step={256}
									class="sampling-range flex-1"
								/>
							{:else}
								<span class="text-xs text-[var(--color-text-muted)]">Unlimited</span>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- System Prompt panel -->
		{#if systemPromptOpen}
			<div class="border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4">
				<div class="mx-auto max-w-3xl">
					<div class="mb-3 flex items-center justify-between">
						<span class="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
							>System Prompt</span
						>
						<div class="flex items-center gap-2">
							<button
								onclick={async () => {
									if (!samplingModelId) return;
									await fetch(`/api/models/${samplingModelId}/system-prompt`, {
										method: 'PUT',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ system_prompt: null })
									});
									modelSystemPrompt = null;
								}}
								disabled={!samplingModelId}
								class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
								>Reset to global</button
							>
							<button
								onclick={async () => {
									if (!samplingModelId) return;
									await fetch(`/api/models/${samplingModelId}/system-prompt`, {
										method: 'PUT',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ system_prompt: modelSystemPrompt })
									});
								}}
								disabled={!samplingModelId}
								class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40 disabled:opacity-50"
								>Save</button
							>
						</div>
					</div>
					<textarea
						bind:value={modelSystemPrompt}
						rows={4}
						placeholder="Leave empty to use global default"
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					></textarea>
				</div>
			</div>
		{/if}

		<!-- Messages -->
		<div
			bind:this={messagesContainer}
			class="flex-1 overflow-y-auto px-4 py-6"
		>
			{#if messages.length === 0}
				<div class="flex h-full flex-col items-center justify-center">
					{#if serverInfo?.status === 'ready' && serverInfo.modelName}
						<p class="font-mono text-sm text-[var(--color-text-secondary)]">
							{serverInfo.modelName}
						</p>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							Send a message to start chatting
						</p>
					{:else}
						<p class="text-sm text-[var(--color-text-muted)]">No model loaded</p>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							<a href="/models" class="text-[var(--color-accent)] hover:underline">Launch a model</a
							> to start chatting
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
												onclick={cancelEdit}
												class="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
												>Cancel</button
											>
											<button
												onclick={saveEdit}
												class="rounded bg-[var(--color-accent-dim)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]"
												>Save</button
											>
										</div>
									</div>
								{:else}
									<div class="group/msg relative">
										{#if !streaming}
											<button
												onclick={() => {
													editingMessageIdx = idx;
													editInput = msg.content;
												}}
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
										<div
											class="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-accent-dim)] px-4 py-2.5"
										>
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
							{@const toolSummary = (() => {
								try {
									const args = JSON.parse(msg.toolArgs ?? '{}');
									if (msg.toolName === 'fetch_url' && args.url) return args.url;
									if (msg.toolName === 'web_search' && args.query) return `"${args.query}"`;
									return '';
								} catch {
									return '';
								}
							})()}
							<div
								class="max-w-[90%] rounded-lg border border-[var(--color-border)] border-l-2 border-l-cyan-500/40 bg-[var(--color-elevated)]"
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
									<span class="text-xs font-medium text-cyan-400/80">{msg.toolName ?? 'tool'}</span>
									{#if toolSummary}
										<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]"
											>{toolSummary}</span
										>
									{/if}
									{#if msg.toolStatus === 'running'}
										<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cyan-400"></span>
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
								{#if isExpanded}
									<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
										{#if msg.toolArgs}
											<p class="font-mono text-xs break-all text-cyan-300/60">
												{msg.toolArgs}
											</p>
										{/if}
										{#if msg.toolStatus === 'done' && msg.content}
											<p
												class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
											>
												{msg.content}
											</p>
										{/if}
									</div>
								{/if}
							</div>
						{:else if msg.role === 'tool'}
							{@const isExpanded = expandedTools.has(idx)}
							{@const toolSummary = (() => {
								try {
									const args = JSON.parse(msg.toolArgs ?? '{}');
									if (msg.toolName === 'fetch_url' && args.url) return args.url;
									if (msg.toolName === 'web_search' && args.query) return `"${args.query}"`;
									return '';
								} catch { return ''; }
							})()}
							<div
								class="max-w-[90%] rounded-lg border border-[var(--color-border)] border-l-2 border-l-cyan-500/40 bg-[var(--color-elevated)]"
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
									<span class="text-xs font-medium text-cyan-400/80"
										>{msg.toolName ?? 'Tool result'}</span
									>
									{#if toolSummary}
										<span class="min-w-0 truncate text-xs text-[var(--color-text-muted)]">{toolSummary}</span>
									{/if}
									<svg
										class="h-3 w-3 shrink-0 text-emerald-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
									</svg>
								</button>
								{#if isExpanded}
									<div class="space-y-1 border-t border-cyan-500/10 px-2.5 py-1.5">
										{#if msg.toolArgs}
											<p class="font-mono text-xs break-all text-cyan-300/60">
												{msg.toolArgs}
											</p>
										{/if}
										<p
											class="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]"
										>
											{msg.content}
										</p>
									</div>
								{/if}
							</div>
						{:else if msg.role === 'assistant'}
							{@const isWaiting = !msg.content && streaming && idx === messages.length - 1}
							{@const segments = parseThinking(msg.content || (isWaiting ? '...' : ''))}
							<div class="max-w-[90%] space-y-2">
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
			{:else}
				{#if !activeConversationId}
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
				<input
					bind:this={imageInputEl}
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					onchange={handleImageSelect}
				/>
				<div class="mx-auto flex max-w-3xl gap-2">
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
					<textarea
						bind:this={textareaEl}
						bind:value={input}
						onkeydown={handleKeydown}
						placeholder={serverInfo?.status === 'ready' ? 'Message...' : 'Load a model first...'}
						rows="1"
						disabled={streaming || serverInfo?.status !== 'ready'}
						class="max-h-[160px] min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
					></textarea>

					{#if streaming}
						<button
							onclick={stopGeneration}
							class="shrink-0 self-end rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
							>Stop</button
						>
					{:else}
						<button
							onclick={sendMessage}
							disabled={(!input.trim() && pendingImages.length === 0) ||
								serverInfo?.status !== 'ready'}
							class="shrink-0 self-end rounded-lg bg-[var(--color-accent-dim)] px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-30"
							>Send</button
						>
					{/if}
				</div>
			{/if}
			{#if input.length > 0}
				<div class="mx-auto mt-1 max-w-3xl">
					<span class="font-mono text-xs text-[var(--color-text-muted)]"
						>~{inputTokenEstimate} tokens</span
					>
				</div>
			{/if}
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
	</div>
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
	:global(.assistant-content .code-block .code-lang) {
		padding: 0.25rem 0.75rem;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.03);
		border-bottom: 1px solid var(--color-border);
		font-family: ui-monospace, monospace;
	}
	:global(.assistant-content .code-body) {
		display: flex;
		overflow-x: auto;
	}
	:global(.assistant-content .line-numbers) {
		flex-shrink: 0;
		padding: 0.75rem 0.75rem 0.75rem 0.75rem;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.35;
		font-size: 0.8rem;
		line-height: 1.5;
		font-family: ui-monospace, monospace;
		white-space: pre;
		user-select: none;
		-webkit-user-select: none;
		border-right: 1px solid var(--color-border);
	}
	:global(.assistant-content .line-numbers span) {
		display: block;
	}
	:global(.assistant-content .code-content) {
		margin: 0;
		padding: 0.75rem;
		font-size: 0.8rem;
		line-height: 1.5;
		flex: 1;
		min-width: 0;
	}
	:global(.assistant-content .code-content code) {
		background: none;
		padding: 0;
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
