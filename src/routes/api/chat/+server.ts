import type { RequestHandler } from './$types';
import { getServerState } from '$lib/server/llama';
import { getSetting } from '$lib/server/settings';
import { getToolDefinitions } from '$lib/server/tools';
import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import type { ToolCall } from '$lib/server/tools/llama-stream';
import { resolveSystemPrompt, buildPlanInjectedPrompt } from '$lib/server/system-prompt';
import { cleanupApproval } from '$lib/server/approval-store';
import { getProject } from '$lib/server/projects';
import { buildMemoryContext } from '$lib/server/tools/memory';
import { performRetrieval } from '$lib/server/chat/retrieval';
import { performPlanning } from '$lib/server/chat/planning';
import { executeToolCall } from '$lib/server/chat/tool-executor';

interface ChatMessage {
	role: string;
	content: string | Array<Record<string, unknown>>;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

function sseEvent(data: string): string {
	return `data: ${data}\n\n`;
}

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
		plan_enabled?: boolean;
		memory_enabled?: boolean;
	};

	if (!body.messages || !Array.isArray(body.messages)) {
		return new Response(JSON.stringify({ error: 'Missing messages array' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const toolsEnabled = body.tools_enabled !== false && getSetting('tools_enabled') !== 'false';
	const memoryEnabled =
		body.memory_enabled !== undefined
			? body.memory_enabled !== false
			: getSetting('memory_enabled') !== 'false';
	const project = body.project_id ? (getProject(body.project_id) ?? undefined) : undefined;
	const resolvedModelId = body.model_id ?? state.modelId ?? null;
	const tools = toolsEnabled ? getToolDefinitions(project, memoryEnabled) : [];
	const systemPrompt = resolveSystemPrompt(resolvedModelId, project);

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
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
				let effectiveSystemPrompt = systemPrompt;

				const llamaUrl = `http://localhost:${state.port}`;
				const samplingParams = body.sampling
					? {
							temperature: body.sampling.temperature,
							top_p: body.sampling.top_p,
							top_k: body.sampling.top_k,
							min_p: body.sampling.min_p,
							repeat_penalty: body.sampling.repeat_penalty
						}
					: {};
				const thinkingBudget = body.sampling?.thinking_budget;

				const emit = (type: string, data: Record<string, unknown>) => {
					controller.enqueue(encoder.encode(sseEvent(JSON.stringify({ type, ...data }))));
				};

				// Planning pass: when plan_enabled and project_id, generate a plan first
				// Skip planning on continuations (when previous message is assistant/tool)
				const prevMsg = normalized.length >= 2 ? normalized[normalized.length - 2] : null;
				const isContinuation = prevMsg?.role === 'assistant' || prevMsg?.role === 'tool';
				if (body.plan_enabled && body.project_id && !isContinuation) {
					// Pass 0: Retrieval - get codebase context for the planning prompt
					const retrievalContext = await performRetrieval({
						project: project!,
						normalizedMessages: normalized,
						llamaUrl,
						samplingParams,
						thinkingBudget,
						signal: AbortSignal.timeout(120_000),
						emit
					});

					// Pass 1: Planning
					const planText = await performPlanning({
						project: project! as { id: number; path: string; name: string },
						normalizedMessages: normalized,
						retrievalContext,
						llamaUrl,
						samplingParams,
						thinkingBudget,
						signal: AbortSignal.timeout(180_000),
						emit
					});

					// Inject plan into the coding system prompt
					if (planText.trim()) {
						effectiveSystemPrompt = buildPlanInjectedPrompt(effectiveSystemPrompt ?? '', planText);
					}
				}

				if (memoryEnabled && effectiveSystemPrompt !== null) {
					const memoryContext = buildMemoryContext();
					if (memoryContext) {
						effectiveSystemPrompt = effectiveSystemPrompt + memoryContext;
					}
				}

				const messages: ChatMessage[] = effectiveSystemPrompt
					? [{ role: 'system', content: effectiveSystemPrompt }, ...normalized]
					: [...normalized];
				let reachedLimit = true;
				let hasRetried = false;

				for (;;) {
					const disableTools = false;
					const llamaRes = await fetch(`${llamaUrl}/v1/chat/completions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(600_000),
						body: JSON.stringify({
							messages,
							stream: true,
							stream_options: { include_usage: true },
							...(tools.length > 0 && !disableTools && { tools }),
							...samplingParams,
							...(thinkingBudget != null &&
								thinkingBudget > 0 && {
									thinking_budget: thinkingBudget
								})
						})
					});

					if (!llamaRes.ok || !llamaRes.body) {
						const text = await llamaRes.text();
						controller.enqueue(
							encoder.encode(
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

					// Detect raw JSON tool calls in content (model outputting JSON instead of using tool_call format)
					if (result.toolCalls.length === 0 && result.content.trim()) {
						const content = result.content.trim();
						try {
							// Try to parse as a single tool call: {"name": "...", "arguments": {...}}
							const parsed = JSON.parse(content);
							if (parsed.name && parsed.arguments) {
								const args =
									typeof parsed.arguments === 'string'
										? parsed.arguments
										: JSON.stringify(parsed.arguments);
								result.toolCalls.push({
									id: `tc_text_${Date.now()}`,
									type: 'function',
									function: { name: parsed.name, arguments: args }
								});
								result.content = '';
							}
						} catch {
							// Not JSON, continue as normal text
						}
					}

					if (result.toolCalls.length > 0) {
						// Emit tool_call events
						for (const tc of result.toolCalls) {
							controller.enqueue(
								encoder.encode(
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
							const execResult = await executeToolCall({
								toolCall: {
									id: tc.id,
									name: tc.function.name,
									arguments: tc.function.arguments
								},
								project: project ?? null,
								controller,
								encoder,
								pendingApprovalIds,
								signal: AbortSignal.timeout(600_000)
							});

							// Append tool result message to context
							messages.push({
								role: 'tool',
								content: execResult.result,
								tool_call_id: tc.id
							});
						}

						// Check if 'done' was called - if so, emit any content and break
						const calledDone = result.toolCalls.some((tc) => tc.function.name === 'done');
						if (calledDone) {
							// Emit any accompanying text content
							if (result.content.trim()) {
								const doneContent = result.reasoning
									? `<think>${result.reasoning}</think>${result.content}`
									: result.content;
								for (let i = 0; i < doneContent.length; i += CHUNK_SIZE) {
									const chunk = doneContent.slice(i, i + CHUNK_SIZE);
									controller.enqueue(
										encoder.encode(sseEvent(JSON.stringify({ type: 'delta', content: chunk })))
									);
								}
							}
							reachedLimit = false;
							break;
						}

						// Continue the loop for the model to process tool results
						continue;
					}

					// No tool calls: text-only response

					// Emit content in chunks
					const fullContent = result.reasoning
						? `<think>${result.reasoning}</think>${result.content}`
						: result.content;

					if (fullContent.trim()) {
						for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
							const chunk = fullContent.slice(i, i + CHUNK_SIZE);
							controller.enqueue(
								encoder.encode(sseEvent(JSON.stringify({ type: 'delta', content: chunk })))
							);
						}
					}

					if (result.usage) {
						controller.enqueue(
							encoder.encode(
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

					// Empty response: auto-retry once
					if (!result.content.trim()) {
						if (!hasRetried) {
							hasRetried = true;
							messages.push({ role: 'assistant', content: '' });
							messages.push({ role: 'user', content: 'Continue with the next step.' });
							continue;
						}
						reachedLimit = false;
						break;
					}

					// Tools are available: model gave an intermediate update.
					// Emit the text, add to history, and let the model continue.
					// The model calls 'done' when it's truly finished.
					if (toolsEnabled && tools.length > 0) {
						messages.push({ role: 'assistant', content: result.content });
						messages.push({ role: 'user', content: 'Continue.' });
						continue;
					}

					reachedLimit = false;
					break;
				}
				if (reachedLimit) {
					controller.enqueue(
						encoder.encode(
							sseEvent(
								JSON.stringify({
									type: 'error',
									message:
										'Tool calling limit reached. The model was forced to produce a final answer.'
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
