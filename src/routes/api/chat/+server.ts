import type { RequestHandler } from './$types';
import { getServerState } from '$lib/server/llama';
import { getSetting } from '$lib/server/settings';
import { getToolDefinitions, executeTool } from '$lib/server/tools';
import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import type { ToolCall } from '$lib/server/tools/llama-stream';
import { resolveSystemPrompt } from '$lib/server/system-prompt';
import { requestApproval, cleanupApproval } from '$lib/server/approval-store';
import { detectDangerousPatterns } from '$lib/server/danger-detect';
import { isLandlockAvailable } from '$lib/server/sandbox';
import { getProject } from '$lib/server/projects';

interface ChatMessage {
	role: string;
	content: string | Array<Record<string, unknown>>;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

function sseEvent(data: string): string {
	return `data: ${data}\n\n`;
}

const MAX_TOOL_ITERATIONS = 10;
const CHUNK_SIZE = 20;

export const POST: RequestHandler = async ({ request }) => {
	const state = getServerState();
	if (state.status !== 'ready') {
		return new Response(JSON.stringify({ error: 'No server running' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const body = (await request.json()) as {
		messages: Array<ChatMessage>;
		sampling?: {
			temperature?: number;
			top_p?: number;
			top_k?: number;
			min_p?: number;
			repeat_penalty?: number;
			thinking_budget?: number;
		};
		tools_enabled?: boolean;
		model_id?: number | null;
		project_id?: number | null;
	};

	if (!body.messages || !Array.isArray(body.messages)) {
		return new Response(JSON.stringify({ error: 'Missing messages array' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const toolsEnabled = body.tools_enabled !== false && getSetting('tools_enabled') !== 'false';
	const project = body.project_id ? (getProject(body.project_id) ?? undefined) : undefined;
	const tools = toolsEnabled ? getToolDefinitions(project) : [];

	const resolvedModelId = body.model_id ?? state.modelId ?? null;
	const systemPrompt = resolveSystemPrompt(resolvedModelId, project);

	const stream = new ReadableStream({
		async start(controller) {
			const pendingApprovalIds: string[] = [];
			try {
				// Ensure all tool_calls have type: "function" (history from DB may lack it)
				const normalized = body.messages.map((m) => {
					if (m.tool_calls) {
						return {
							...m,
							tool_calls: m.tool_calls.map((tc) => ({ ...tc, type: 'function' as const }))
						};
					}
					return m;
				});
				const messages: ChatMessage[] = systemPrompt
					? [{ role: 'system', content: systemPrompt }, ...normalized]
					: [...normalized];
				let reachedLimit = true;

				for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
					const llamaRes = await fetch(`http://localhost:${state.port}/v1/chat/completions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							messages,
							stream: true,
							stream_options: { include_usage: true },
							...(tools.length > 0 && { tools }),
							...(body.sampling && {
								temperature: body.sampling.temperature,
								top_p: body.sampling.top_p,
								top_k: body.sampling.top_k,
								min_p: body.sampling.min_p,
								repeat_penalty: body.sampling.repeat_penalty
							}),
							...(body.sampling?.thinking_budget != null &&
								body.sampling.thinking_budget > 0 && {
									thinking_budget: body.sampling.thinking_budget
								})
						})
					});

					if (!llamaRes.ok || !llamaRes.body) {
						const text = await llamaRes.text();
						controller.enqueue(
							new TextEncoder().encode(
								sseEvent(
									JSON.stringify({
										type: 'delta',
										content: `Error: llama-server returned ${llamaRes.status}: ${text}`
									})
								)
							)
						);
						reachedLimit = false;
						break;
					}

					const result = await consumeLlamaStream(llamaRes.body);

					if (result.toolCalls.length > 0) {
						// Emit tool_call events
						for (const tc of result.toolCalls) {
							controller.enqueue(
								new TextEncoder().encode(
									sseEvent(
										JSON.stringify({
											type: 'tool_call',
											id: tc.id,
											name: tc.function.name,
											arguments: tc.function.arguments
										})
									)
								)
							);
						}

						// Append assistant message with tool calls to context
						messages.push({
							role: 'assistant',
							content: result.content || '',
							tool_calls: result.toolCalls
						});

						// Execute each tool and emit results
						for (const tc of result.toolCalls) {
							let args: Record<string, unknown>;
							try {
								args = JSON.parse(tc.function.arguments);
							} catch {
								args = {};
							}

							let toolResult: string;
							let fileChanged: { path: string; operation: 'created' | 'modified' } | undefined;

							// Approval flow for run_command
							if (tc.function.name === 'run_command' && typeof args.command === 'string') {
								const command = args.command;
								const dangers = detectDangerousPatterns(command);
								const requestId = crypto.randomUUID();
								pendingApprovalIds.push(requestId);

								controller.enqueue(
									new TextEncoder().encode(
										sseEvent(
											JSON.stringify({
												type: 'approval_request',
												requestId,
												command,
												dangers,
												sandboxed: isLandlockAvailable()
											})
										)
									)
								);

								const approvalResult = await requestApproval(requestId);
								// Remove from pending list after resolution
								const idx = pendingApprovalIds.indexOf(requestId);
								if (idx !== -1) pendingApprovalIds.splice(idx, 1);

								if (approvalResult === 'timeout') {
									toolResult = 'Command approval timed out';
								} else if (approvalResult === 'denied') {
									toolResult = 'Command denied by user';
								} else {
									try {
										const execResult = await executeTool(tc.function.name, args, project);
										toolResult = execResult.result;
										fileChanged = execResult.fileChanged;
									} catch (e) {
										toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
									}
								}
							} else {
								try {
									const execResult = await executeTool(tc.function.name, args, project);
									toolResult = execResult.result;
									fileChanged = execResult.fileChanged;
								} catch (e) {
									toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
								}
							}

							if (fileChanged) {
								controller.enqueue(
									new TextEncoder().encode(
										sseEvent(
											JSON.stringify({
												type: 'file_changed',
												path: fileChanged.path,
												operation: fileChanged.operation
											})
										)
									)
								);
							}

							controller.enqueue(
								new TextEncoder().encode(
									sseEvent(
										JSON.stringify({
											type: 'tool_result',
											id: tc.id,
											name: tc.function.name,
											content: toolResult
										})
									)
								)
							);

							// Append tool result message to context
							messages.push({
								role: 'tool',
								content: toolResult,
								tool_call_id: tc.id
							});
						}

						// Continue the loop for the model to process tool results
						continue;
					}

					// No tool calls: this is the final answer
					// Emit content in chunks for smoother UI
					const content = result.content;
					for (let i = 0; i < content.length; i += CHUNK_SIZE) {
						const chunk = content.slice(i, i + CHUNK_SIZE);
						controller.enqueue(
							new TextEncoder().encode(sseEvent(JSON.stringify({ type: 'delta', content: chunk })))
						);
					}

					if (result.usage) {
						controller.enqueue(
							new TextEncoder().encode(
								sseEvent(
									JSON.stringify({
										type: 'usage',
										prompt_tokens: result.usage.prompt_tokens,
										completion_tokens: result.usage.completion_tokens,
										total_tokens: result.usage.total_tokens
									})
								)
							)
						);
					}

					reachedLimit = false;
					break;
				}
				if (reachedLimit) {
					controller.enqueue(
						new TextEncoder().encode(
							sseEvent(
								JSON.stringify({
									type: 'delta',
									content:
										'[Tool calling limit reached. The model called tools too many times without producing a final answer.]'
								})
							)
						)
					);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to connect to llama-server';
				controller.enqueue(
					new TextEncoder().encode(
						sseEvent(JSON.stringify({ type: 'delta', content: `Error: ${message}` }))
					)
				);
			} finally {
				for (const id of pendingApprovalIds) {
					cleanupApproval(id);
				}
				controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
