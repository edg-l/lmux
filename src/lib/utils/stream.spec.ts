import { describe, it, expect } from 'bun:test';
import { processSSEStream } from './stream';
import type { StreamCallbacks } from './stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Response whose body yields the given raw text chunks one-by-one. */
function makeResponse(chunks: string[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
	return new Response(stream);
}

/** Build a Response from a single string. */
function makeResponseFromString(text: string): Response {
	return makeResponse([text]);
}

/** Build an SSE data line for a JSON payload. */
function dataLine(obj: object): string {
	return `data: ${JSON.stringify(obj)}\n`;
}

/** Minimal no-op callbacks; individual tests override what they need. */
function makeCallbacks(overrides: Partial<StreamCallbacks> = {}): StreamCallbacks {
	return {
		onDelta: () => {},
		onToolCall: () => {},
		onToolResult: () => {},
		getAssistantContent: () => '',
		onUsage: () => {},
		getMessageCount: () => 0,
		...overrides
	};
}

const noSignal = new AbortController().signal;

// ---------------------------------------------------------------------------
// Empty / trivial streams
// ---------------------------------------------------------------------------

describe('processSSEStream – empty stream', () => {
	it('returns empty pendingToolMessages and aborted=false for an empty body', async () => {
		const response = makeResponseFromString('');
		const result = await processSSEStream(response, noSignal, makeCallbacks());
		expect(result.pendingToolMessages).toEqual([]);
		expect(result.aborted).toBe(false);
	});

	it('ignores a [DONE] sentinel line', async () => {
		const response = makeResponseFromString('data: [DONE]\n');
		const deltas: string[] = [];
		const result = await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onDelta: (c) => deltas.push(c) })
		);
		expect(deltas).toEqual([]);
		expect(result.pendingToolMessages).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// delta events
// ---------------------------------------------------------------------------

describe('processSSEStream – delta events', () => {
	it('calls onDelta with the content field', async () => {
		const response = makeResponseFromString(dataLine({ type: 'delta', content: 'Hello' }));
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['Hello']);
	});

	it('calls onDelta for each delta event in order', async () => {
		const text =
			dataLine({ type: 'delta', content: 'one' }) +
			dataLine({ type: 'delta', content: ' two' }) +
			dataLine({ type: 'delta', content: ' three' });
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['one', ' two', ' three']);
	});
});

// ---------------------------------------------------------------------------
// tool_call events
// ---------------------------------------------------------------------------

describe('processSSEStream – tool_call events', () => {
	it('calls onToolCall with correct ToolCallData and status index', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'tool_call', id: 'tc1', name: 'bash', arguments: '{"cmd":"ls"}' })
		);
		const calls: Array<{ tc: object; idx: number }> = [];
		let msgCount = 5;
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				getMessageCount: () => msgCount,
				onToolCall: (tc, idx) => calls.push({ tc, idx })
			})
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].tc).toEqual({
			id: 'tc1',
			function: { name: 'bash', arguments: '{"cmd":"ls"}' }
		});
		expect(calls[0].idx).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// tool_result events
// ---------------------------------------------------------------------------

describe('processSSEStream – tool_result events', () => {
	it('calls onToolResult and produces two pendingToolMessages', async () => {
		const text =
			dataLine({ type: 'tool_call', id: 'tc1', name: 'bash', arguments: '{}' }) +
			dataLine({ type: 'tool_result', id: 'tc1', content: 'output text', error: false });
		const response = makeResponseFromString(text);
		const toolResults: Array<{ id: string; content: string; error?: boolean }> = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				getMessageCount: () => 0,
				getAssistantContent: () => 'assistant text',
				onToolResult: (id, content, _idx, error) => toolResults.push({ id, content, error })
			})
		);
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]).toEqual({ id: 'tc1', content: 'output text', error: false });
	});

	it('pushes assistant + tool pendingToolMessages in the right order', async () => {
		const text =
			dataLine({ type: 'tool_call', id: 'tc1', name: 'bash', arguments: '{}' }) +
			dataLine({ type: 'tool_result', id: 'tc1', content: 'result', error: false });
		const response = makeResponseFromString(text);
		const result = await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				getMessageCount: () => 0,
				getAssistantContent: (count) => `assistant(${count})`
			})
		);
		expect(result.pendingToolMessages).toHaveLength(2);
		expect(result.pendingToolMessages[0].role).toBe('assistant');
		expect(result.pendingToolMessages[0].content).toBe('assistant(1)');
		expect(result.pendingToolMessages[1].role).toBe('tool');
		expect(result.pendingToolMessages[1].content).toBe('result');
		expect(result.pendingToolMessages[1].toolCallId).toBe('tc1');
	});

	it('forwards the error flag from tool_result', async () => {
		const text =
			dataLine({ type: 'tool_call', id: 'tc2', name: 'bash', arguments: '{}' }) +
			dataLine({ type: 'tool_result', id: 'tc2', content: 'boom', error: true });
		const response = makeResponseFromString(text);
		const toolResults: Array<{ error?: boolean }> = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				getMessageCount: () => 0,
				getAssistantContent: () => '',
				onToolResult: (_id, _content, _idx, error) => toolResults.push({ error })
			})
		);
		expect(toolResults[0].error).toBe(true);
	});

	it('tool_result without preceding tool_call produces no assistant message', async () => {
		const text = dataLine({ type: 'tool_result', id: 'orphan', content: 'x', error: false });
		const response = makeResponseFromString(text);
		const result = await processSSEStream(response, noSignal, makeCallbacks());
		// Only the tool message should be pushed (no assistant message because currentToolCalls was empty)
		expect(result.pendingToolMessages).toHaveLength(1);
		expect(result.pendingToolMessages[0].role).toBe('tool');
	});
});

// ---------------------------------------------------------------------------
// usage events
// ---------------------------------------------------------------------------

describe('processSSEStream – usage events', () => {
	it('calls onUsage with correct token counts', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'usage', prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })
		);
		const usages: object[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onUsage: (u) => usages.push(u) }));
		expect(usages).toHaveLength(1);
		expect(usages[0]).toEqual({ prompt: 10, completion: 20, total: 30 });
	});

	it('defaults missing token fields to 0', async () => {
		const response = makeResponseFromString(dataLine({ type: 'usage' }));
		const usages: object[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onUsage: (u) => usages.push(u) }));
		expect(usages[0]).toEqual({ prompt: 0, completion: 0, total: 0 });
	});
});

// ---------------------------------------------------------------------------
// approval_request events
// ---------------------------------------------------------------------------

describe('processSSEStream – approval_request events', () => {
	it('calls onApprovalRequest with correct data', async () => {
		const danger = { segment: 'rm -rf', label: 'rm -rf', startIndex: 0, endIndex: 6 };
		const response = makeResponseFromString(
			dataLine({
				type: 'approval_request',
				requestId: 'req1',
				command: 'rm -rf /tmp',
				dangers: [danger],
				sandboxed: true
			})
		);
		const received: object[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onApprovalRequest: (d) => received.push(d) })
		);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({
			requestId: 'req1',
			command: 'rm -rf /tmp',
			dangers: [danger],
			sandboxed: true
		});
	});

	it('defaults dangers to [] and sandboxed to true when absent', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'approval_request', requestId: 'r2', command: 'ls' })
		);
		const received: object[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onApprovalRequest: (d) => received.push(d) })
		);
		expect(received[0]).toMatchObject({ dangers: [], sandboxed: true });
	});

	it('does not throw when onApprovalRequest callback is absent', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'approval_request', requestId: 'r3', command: 'ls' })
		);
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// sandbox_blocked events
// ---------------------------------------------------------------------------

describe('processSSEStream – sandbox_blocked events', () => {
	it('calls onSandboxBlocked with correct data', async () => {
		const response = makeResponseFromString(
			dataLine({
				type: 'sandbox_blocked',
				requestId: 'sb1',
				paths: ['/etc'],
				absolutePaths: ['/etc']
			})
		);
		const received: object[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onSandboxBlocked: (d) => received.push(d) })
		);
		expect(received[0]).toEqual({ requestId: 'sb1', paths: ['/etc'], absolutePaths: ['/etc'] });
	});

	it('defaults paths and absolutePaths to [] when absent', async () => {
		const response = makeResponseFromString(dataLine({ type: 'sandbox_blocked' }));
		const received: object[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onSandboxBlocked: (d) => received.push(d) })
		);
		expect(received[0]).toMatchObject({ paths: [], absolutePaths: [] });
	});
});

// ---------------------------------------------------------------------------
// file_changed events
// ---------------------------------------------------------------------------

describe('processSSEStream – file_changed events', () => {
	it('calls onFileChanged with path and operation', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'file_changed', path: 'src/foo.ts', operation: 'modified' })
		);
		const received: object[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onFileChanged: (d) => received.push(d) })
		);
		expect(received[0]).toEqual({ path: 'src/foo.ts', operation: 'modified' });
	});

	it('does not throw when onFileChanged callback is absent', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'file_changed', path: 'x.ts', operation: 'created' })
		);
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// error events
// ---------------------------------------------------------------------------

describe('processSSEStream – error events', () => {
	it('calls onError with the message field', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'error', message: 'something went wrong' })
		);
		const errors: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onError: (e) => errors.push(e) }));
		expect(errors).toEqual(['something went wrong']);
	});

	it('falls back to error field when message is absent', async () => {
		const response = makeResponseFromString(dataLine({ type: 'error', error: 'fallback error' }));
		const errors: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onError: (e) => errors.push(e) }));
		expect(errors).toEqual(['fallback error']);
	});

	it('uses "Unknown error" when neither message nor error field present', async () => {
		const response = makeResponseFromString(dataLine({ type: 'error' }));
		const errors: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onError: (e) => errors.push(e) }));
		expect(errors).toEqual(['Unknown error']);
	});

	it('does not throw when onError callback is absent', async () => {
		const response = makeResponseFromString(dataLine({ type: 'error', message: 'oops' }));
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// plan_delta events
// ---------------------------------------------------------------------------

describe('processSSEStream – plan_delta events', () => {
	it('calls onPlanDelta with the content field', async () => {
		const response = makeResponseFromString(
			dataLine({ type: 'plan_delta', content: '1. Read file' })
		);
		const deltas: string[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onPlanDelta: (c) => deltas.push(c) })
		);
		expect(deltas).toEqual(['1. Read file']);
	});

	it('calls onPlanDelta for each chunk in order', async () => {
		const text =
			dataLine({ type: 'plan_delta', content: '1. Read' }) +
			dataLine({ type: 'plan_delta', content: ' the file' });
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onPlanDelta: (c) => deltas.push(c) })
		);
		expect(deltas).toEqual(['1. Read', ' the file']);
	});

	it('does not throw when onPlanDelta callback is absent', async () => {
		const response = makeResponseFromString(dataLine({ type: 'plan_delta', content: 'step' }));
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// plan_done events
// ---------------------------------------------------------------------------

describe('processSSEStream – plan_done events', () => {
	it('calls onPlanDone with the full plan text', async () => {
		const fullPlan = '1. Read file\n2. Edit file\n3. Verify';
		const response = makeResponseFromString(dataLine({ type: 'plan_done', content: fullPlan }));
		const received: string[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({ onPlanDone: (c) => received.push(c) })
		);
		expect(received).toEqual([fullPlan]);
	});

	it('does not throw when onPlanDone callback is absent', async () => {
		const response = makeResponseFromString(dataLine({ type: 'plan_done', content: 'plan text' }));
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});

	it('handles plan_delta followed by plan_done', async () => {
		const text =
			dataLine({ type: 'plan_delta', content: '1. Step one' }) +
			dataLine({ type: 'plan_delta', content: '\n2. Step two' }) +
			dataLine({ type: 'plan_done', content: '1. Step one\n2. Step two' });
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		const dones: string[] = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				onPlanDelta: (c) => deltas.push(c),
				onPlanDone: (c) => dones.push(c)
			})
		);
		expect(deltas).toEqual(['1. Step one', '\n2. Step two']);
		expect(dones).toEqual(['1. Step one\n2. Step two']);
	});
});

// ---------------------------------------------------------------------------
// planning_tool_call events
// ---------------------------------------------------------------------------

describe('processSSEStream – planning_tool_call events', () => {
	it('calls onPlanningToolCall with name, arguments, and result_preview', async () => {
		const response = makeResponseFromString(
			dataLine({
				type: 'planning_tool_call',
				name: 'read_file',
				arguments: '{"path":"src/main.ts"}',
				result_preview: 'fn main() {'
			})
		);
		const calls: Array<{ name: string; args: string; preview: string }> = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				onPlanningToolCall: (name, args, preview) => calls.push({ name, args, preview })
			})
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe('read_file');
		expect(calls[0].args).toBe('{"path":"src/main.ts"}');
		expect(calls[0].preview).toBe('fn main() {');
	});

	it('handles multiple planning_tool_call events in order', async () => {
		const text =
			dataLine({
				type: 'planning_tool_call',
				name: 'read_file',
				arguments: '{"path":"a.ts"}'
			}) +
			dataLine({
				type: 'planning_tool_call',
				name: 'search_files',
				arguments: '{"pattern":"TODO"}'
			});
		const response = makeResponseFromString(text);
		const calls: Array<{ name: string; args: string }> = [];
		await processSSEStream(
			response,
			noSignal,
			makeCallbacks({
				onPlanningToolCall: (name, args, _preview) => calls.push({ name, args })
			})
		);
		expect(calls).toHaveLength(2);
		expect(calls[0].name).toBe('read_file');
		expect(calls[1].name).toBe('search_files');
	});

	it('does not throw when onPlanningToolCall callback is absent', async () => {
		const response = makeResponseFromString(
			dataLine({
				type: 'planning_tool_call',
				name: 'list_directory',
				arguments: '{}'
			})
		);
		await expect(processSSEStream(response, noSignal, makeCallbacks())).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Edge cases: malformed / non-data lines
// ---------------------------------------------------------------------------

describe('processSSEStream – malformed and non-data lines', () => {
	it('skips lines that do not start with "data: "', async () => {
		const text = 'event: ping\nid: 123\n: comment\ndata: {"type":"delta","content":"ok"}\n';
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['ok']);
	});

	it('skips malformed JSON without throwing', async () => {
		const text = 'data: {NOT_VALID_JSON}\ndata: {"type":"delta","content":"after"}\n';
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['after']);
	});

	it('handles empty data lines gracefully', async () => {
		const text = 'data: \ndata: {"type":"delta","content":"x"}\n';
		const response = makeResponseFromString(text);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['x']);
	});

	it('ignores unknown event types silently', async () => {
		const response = makeResponseFromString(dataLine({ type: 'mystery_type', payload: 42 }));
		const result = await processSSEStream(response, noSignal, makeCallbacks());
		expect(result.pendingToolMessages).toEqual([]);
		expect(result.aborted).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Edge cases: chunked / split data
// ---------------------------------------------------------------------------

describe('processSSEStream – partial and multi-chunk delivery', () => {
	it('reassembles a line split across two chunks', async () => {
		// The newline is in the second chunk, so the first chunk is buffered.
		const part1 = 'data: {"type":"delta","con';
		const part2 = 'tent":"split"}\n';
		const response = makeResponse([part1, part2]);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['split']);
	});

	it('processes multiple events delivered in a single chunk', async () => {
		const chunk =
			dataLine({ type: 'delta', content: 'a' }) +
			dataLine({ type: 'delta', content: 'b' }) +
			dataLine({ type: 'delta', content: 'c' });
		const response = makeResponse([chunk]);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['a', 'b', 'c']);
	});

	it('handles content spread across many tiny chunks', async () => {
		const line = 'data: {"type":"delta","content":"tiny"}\n';
		const chunks = line.split('').map((c) => c); // one char per chunk
		const response = makeResponse(chunks);
		const deltas: string[] = [];
		await processSSEStream(response, noSignal, makeCallbacks({ onDelta: (c) => deltas.push(c) }));
		expect(deltas).toEqual(['tiny']);
	});
});

// ---------------------------------------------------------------------------
// AbortError handling
// ---------------------------------------------------------------------------

describe('processSSEStream – AbortError', () => {
	it('returns aborted=true when the stream throws a DOMException AbortError', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new DOMException('aborted', 'AbortError'));
			}
		});
		const response = new Response(stream);
		const result = await processSSEStream(response, noSignal, makeCallbacks());
		expect(result.aborted).toBe(true);
	});

	it('rethrows non-abort errors', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error('network failure'));
			}
		});
		const response = new Response(stream);
		await expect(processSSEStream(response, noSignal, makeCallbacks())).rejects.toThrow(
			'network failure'
		);
	});
});
