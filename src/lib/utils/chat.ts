import type { Message, ToolCallData, DangerSegment } from '$lib/types/chat';

export function enrichToolMessages(msgs: Message[]): Message[] {
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

export function parseThinking(
	content: string
): Array<{ type: 'text' | 'thinking'; content: string }> {
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

export function linkifyText(text: string): string {
	const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return escaped.replace(
		/(https?:\/\/[^\s<]+)/g,
		'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
	);
}

export function getToolSummary(toolName: string | undefined, toolArgs: string | undefined): string {
	try {
		const args = JSON.parse(toolArgs ?? '{}');
		if (toolName === 'fetch_url' && args.url) return args.url;
		if (toolName === 'web_search' && args.query) return `"${args.query}"`;
		if (toolName === 'run_command' && args.command) return args.command.slice(0, 60);
		if (toolName === 'read_file' && args.path) return args.path;
		if (toolName === 'write_file' && args.path) return args.path;
		if (toolName === 'edit_file' && args.path) return args.path;
		if (toolName === 'insert_lines' && args.path) return `${args.path}:${args.line ?? 0}`;
		if (toolName === 'search_files' && args.pattern)
			return `"${args.pattern}"${args.glob ? ` (${args.glob})` : ''}`;
		if (toolName === 'list_directory') return args.path || '/';
		return '';
	} catch {
		return '';
	}
}

export function exportChat(
	messages: Message[],
	conversationId: number | null,
	format: 'markdown' | 'json'
): void {
	const chatMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
	let content: string;
	let filename: string;
	let mime: string;

	if (format === 'markdown') {
		content = chatMessages
			.map((m) => {
				const role = m.role === 'user' ? 'User' : 'Assistant';
				return `## ${role}\n\n${m.content}`;
			})
			.join('\n\n');
		filename = `chat-${conversationId ?? 'new'}.md`;
		mime = 'text/markdown';
	} else {
		content = JSON.stringify(chatMessages, null, 2);
		filename = `chat-${conversationId ?? 'new'}.json`;
		mime = 'application/json';
	}

	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function prepareMessagesForApi(messages: Message[]): Record<string, unknown>[] {
	const allowedRoles = new Set(['user', 'assistant', 'tool', 'system']);
	return messages
		.filter((m) => allowedRoles.has(m.role))
		.map((m) => {
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
}

export function highlightDangers(command: string, dangers: DangerSegment[]): string {
	if (dangers.length === 0) {
		return command.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	const sorted = [...dangers].sort((a, b) => a.startIndex - b.startIndex);
	let result = '';
	let pos = 0;
	for (const d of sorted) {
		const before = command.slice(pos, d.startIndex);
		const dangerous = command.slice(d.startIndex, d.endIndex);
		result +=
			before.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
			`<span class="text-red-400 font-semibold" title="${d.label}">${dangerous.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
		pos = d.endIndex;
	}
	const tail = command.slice(pos);
	result += tail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return result;
}
