import type { ToolCallData, PendingToolMessage, TokenUsage, DangerSegment } from '$lib/types/chat';

export interface StreamCallbacks {
	onDelta: (content: string) => void;
	onToolCall: (tc: ToolCallData, statusIdx: number) => void;
	onToolResult: (id: string, content: string, statusIdx: number | undefined, error?: boolean) => void;
	getAssistantContent: (toolCallCount: number) => string;
	onUsage: (usage: TokenUsage) => void;
	onApprovalRequest?: (data: {
		requestId: string;
		command: string;
		dangers: DangerSegment[];
		sandboxed: boolean;
	}) => void;
	onSandboxBlocked?: (data: {
		requestId?: string;
		paths: string[];
		absolutePaths: string[];
	}) => void;
	onFileChanged?: (data: { path: string; operation: string }) => void;
	onError?: (error: string) => void;
	getMessageCount: () => number;
}

export interface StreamResult {
	pendingToolMessages: PendingToolMessage[];
	aborted: boolean;
}

export async function processSSEStream(
	response: Response,
	_signal: AbortSignal,
	callbacks: StreamCallbacks
): Promise<StreamResult> {
	const pendingToolMessages: PendingToolMessage[] = [];
	const toolStatusIndices = new Map<string, number>();
	let currentToolCalls: ToolCallData[] = [];

	const processLines = (lines: string[]) => {
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.slice(6).trim();
			if (data === '[DONE]') continue;
			try {
				const parsed = JSON.parse(data);

				if (parsed.type === 'delta') {
					callbacks.onDelta(parsed.content);
				} else if (parsed.type === 'tool_call') {
					const tc: ToolCallData = {
						id: parsed.id,
						function: { name: parsed.name, arguments: parsed.arguments }
					};
					currentToolCalls.push(tc);

					const statusIdx = callbacks.getMessageCount();
					toolStatusIndices.set(parsed.id, statusIdx);
					callbacks.onToolCall(tc, statusIdx);
				} else if (parsed.type === 'tool_result') {
					const statusIdx = toolStatusIndices.get(parsed.id);
					callbacks.onToolResult(parsed.id, parsed.content, statusIdx, parsed.error);

					if (currentToolCalls.length > 0) {
						const assistantContent = callbacks.getAssistantContent(currentToolCalls.length);
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
				} else if (parsed.type === 'usage') {
					callbacks.onUsage({
						prompt: parsed.prompt_tokens ?? 0,
						completion: parsed.completion_tokens ?? 0,
						total: parsed.total_tokens ?? 0
					});
				} else if (parsed.type === 'approval_request' && callbacks.onApprovalRequest) {
					callbacks.onApprovalRequest({
						requestId: parsed.requestId,
						command: parsed.command,
						dangers: parsed.dangers ?? [],
						sandboxed: parsed.sandboxed ?? true
					});
				} else if (parsed.type === 'sandbox_blocked' && callbacks.onSandboxBlocked) {
					callbacks.onSandboxBlocked({
						requestId: parsed.requestId,
						paths: parsed.paths ?? [],
						absolutePaths: parsed.absolutePaths ?? []
					});
				} else if (parsed.type === 'file_changed' && callbacks.onFileChanged) {
					callbacks.onFileChanged({
						path: parsed.path,
						operation: parsed.operation
					});
				} else if (parsed.type === 'error' && callbacks.onError) {
					callbacks.onError(parsed.message ?? parsed.error ?? 'Unknown error');
				}
			} catch {
				/* skip malformed JSON */
			}
		}
	};

	try {
		const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += value;
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			processLines(lines);
		}

		return { pendingToolMessages, aborted: false };
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			return { pendingToolMessages, aborted: true };
		}
		throw err;
	}
}
