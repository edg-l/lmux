export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface StreamResult {
	content: string;
	toolCalls: ToolCall[];
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export async function consumeLlamaStream(body: ReadableStream<Uint8Array>): Promise<StreamResult> {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = '';
	let content = '';
	const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
	let usage: StreamResult['usage'] = null;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.slice(6).trim();
			if (data === '[DONE]') continue;

			try {
				const parsed = JSON.parse(data);
				const choice = parsed.choices?.[0];

				if (choice?.delta?.content) {
					content += choice.delta.content;
				}

				if (choice?.delta?.tool_calls) {
					for (const tc of choice.delta.tool_calls) {
						const idx = tc.index as number;
						const existing = toolCallMap.get(idx);
						if (existing) {
							if (tc.function?.name && !existing.name) {
								existing.name = tc.function.name;
							}
							if (tc.function?.arguments) {
								existing.arguments += tc.function.arguments;
							}
						} else {
							toolCallMap.set(idx, {
								id: tc.id ?? `tc_${idx}`,
								name: tc.function?.name ?? '',
								arguments: tc.function?.arguments ?? ''
							});
						}
					}
				}

				if (parsed.usage) {
					usage = {
						prompt_tokens: parsed.usage.prompt_tokens ?? 0,
						completion_tokens: parsed.usage.completion_tokens ?? 0,
						total_tokens: parsed.usage.total_tokens ?? 0
					};
				}
			} catch {
				// skip unparseable lines
			}
		}
	}

	const toolCalls: ToolCall[] = Array.from(toolCallMap.entries())
		.sort(([a], [b]) => a - b)
		.map(([, tc]) => ({
			id: tc.id,
			type: 'function' as const,
			function: { name: tc.name, arguments: tc.arguments }
		}));

	return { content, toolCalls, usage };
}
