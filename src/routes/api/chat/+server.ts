import type { RequestHandler } from './$types';
import { getServerState } from '$lib/server/llama';
import { getSetting } from '$lib/server/settings';
import { getToolDefinitions, executeTool } from '$lib/server/tools';
import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import type { ToolCall } from '$lib/server/tools/llama-stream';
import {
	resolveSystemPrompt,
	PLANNING_SYSTEM_PROMPT,
	RETRIEVAL_SYSTEM_PROMPT,
	buildPlanInjectedPrompt,
	parseSearchTerms
} from '$lib/server/system-prompt';
import { searchProjectFiles } from '$lib/server/tools/search-files';
import { listProjectDirectory } from '$lib/server/tools/list-directory';
import { readProjectFile } from '$lib/server/tools/read-file';
import {
	requestApproval,
	cleanupApproval,
	requestSandboxResolution
} from '$lib/server/approval-store';
import { detectDangerousPatterns } from '$lib/server/danger-detect';
import { isLandlockAvailable } from '$lib/server/sandbox';
import { getProject } from '$lib/server/projects';
import { isCommandApproved, recordApprovalResult } from '$lib/server/sandbox-rules';
import { homedir } from 'node:os';

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
				let effectiveSystemPrompt = systemPrompt;

				// Planning pass: when plan_enabled and project_id, generate a plan first
				// Skip planning on continuations (when previous message is assistant/tool)
				const prevMsg = normalized.length >= 2 ? normalized[normalized.length - 2] : null;
				const isContinuation = prevMsg?.role === 'assistant' || prevMsg?.role === 'tool';
				if (body.plan_enabled && body.project_id && !isContinuation) {
					// Pass 0: Retrieval - get codebase context for the planning prompt
					controller.enqueue(
						new TextEncoder().encode(
							sseEvent(JSON.stringify({ type: 'retrieval_status', status: 'searching' }))
						)
					);
					let retrievalContext = '';
					try {
						// Get project directory tree
						const tree = await listProjectDirectory({ depth: 3 }, project!.path);
						retrievalContext += `## Project Structure\n${tree}\n\n`;

						// Ask the model for search terms
						const retrievalMessages: ChatMessage[] = [
							{ role: 'system', content: RETRIEVAL_SYSTEM_PROMPT },
							...normalized
						];

						const retrievalRes = await fetch(`http://localhost:${state.port}/v1/chat/completions`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							signal: AbortSignal.timeout(120_000),
							body: JSON.stringify({
								messages: retrievalMessages,
								stream: true,
								stream_options: { include_usage: true },
								max_tokens: 1024,
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

						if (retrievalRes.ok && retrievalRes.body) {
							const retrievalResult = await consumeLlamaStream(retrievalRes.body);
							const searchTerms = parseSearchTerms(retrievalResult.content);

							if (searchTerms.length > 0) {
								// Search for each term and collect unique file paths
								const seenFiles = new Set<string>();
								const snippets: string[] = [];

								for (const term of searchTerms) {
									const results = await searchProjectFiles({ pattern: term }, project!.path);
									if (results === 'No matches found.') continue;

									// Extract unique file paths from rg output (path:line:content)
									for (const line of results.split('\n')) {
										const match = line.match(/^([^:]+):\d+:/);
										if (match && !seenFiles.has(match[1])) {
											seenFiles.add(match[1]);
										}
									}
								}

								// Read first 50 lines of up to 5 relevant files
								const filesToRead = [...seenFiles].slice(0, 5);
								for (const filePath of filesToRead) {
									// Convert absolute path to relative
									const relPath = filePath.startsWith(project!.path)
										? filePath.slice(project!.path.length + 1)
										: filePath;
									const content = await readProjectFile(
										{ path: relPath, limit: 50 },
										project!.path
									);
									if (!content.startsWith('File not found')) {
										snippets.push(`### ${relPath}\n\`\`\`\n${content}\n\`\`\``);
									}
								}

								if (snippets.length > 0) {
									retrievalContext += `## Relevant Files\n${snippets.join('\n\n')}\n`;
								}
							}
						}
					} catch {
						// Retrieval is best-effort, continue without it
					}

					controller.enqueue(
						new TextEncoder().encode(
							sseEvent(JSON.stringify({ type: 'retrieval_status', status: 'done' }))
						)
					);

					// Build planning prompt with retrieval context
					const planningPrompt = retrievalContext
						? `${PLANNING_SYSTEM_PROMPT}\n\n## Codebase Context\n${retrievalContext}`
						: PLANNING_SYSTEM_PROMPT;

					const planMessages: ChatMessage[] = [
						{ role: 'system', content: planningPrompt },
						...normalized
					];

					const planRes = await fetch(`http://localhost:${state.port}/v1/chat/completions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(180_000),
						body: JSON.stringify({
							messages: planMessages,
							stream: true,
							stream_options: { include_usage: true },
							max_tokens: 4096,
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

					if (planRes.ok && planRes.body) {
						const planResult = await consumeLlamaStream(planRes.body);
						const planText = planResult.content;

						// Emit plan chunks for UI streaming
						for (let i = 0; i < planText.length; i += CHUNK_SIZE) {
							const chunk = planText.slice(i, i + CHUNK_SIZE);
							controller.enqueue(
								new TextEncoder().encode(
									sseEvent(JSON.stringify({ type: 'plan_delta', content: chunk }))
								)
							);
						}

						// Emit plan_done with full text
						controller.enqueue(
							new TextEncoder().encode(
								sseEvent(JSON.stringify({ type: 'plan_done', content: planText }))
							)
						);

						// Inject plan into the coding system prompt
						if (planText.trim()) {
							effectiveSystemPrompt = buildPlanInjectedPrompt(
								effectiveSystemPrompt ?? '',
								planText
							);
						}
					}
				}

				const messages: ChatMessage[] = effectiveSystemPrompt
					? [{ role: 'system', content: effectiveSystemPrompt }, ...normalized]
					: [...normalized];
				let reachedLimit = true;
				let hasRetried = false;

				for (;;) {
					const disableTools = false;
					const llamaRes = await fetch(`http://localhost:${state.port}/v1/chat/completions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: AbortSignal.timeout(600_000),
						body: JSON.stringify({
							messages,
							stream: true,
							stream_options: { include_usage: true },
							...(tools.length > 0 && !disableTools && { tools }),
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
							let toolError = false;
							let fileChanged:
								| { path: string; operation: 'created' | 'modified'; oldContent?: string }
								| undefined;
							let blockedPaths: string[] = [];

							// Approval flow for run_command and start_process
							if (
								(tc.function.name === 'run_command' || tc.function.name === 'start_process') &&
								typeof args.command === 'string'
							) {
								const command = args.command;
								const autoApproved = isCommandApproved(command);

								if (!autoApproved) {
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

									const approvalResult = await requestApproval(requestId, command);
									// Remove from pending list after resolution
									const idx = pendingApprovalIds.indexOf(requestId);
									if (idx !== -1) pendingApprovalIds.splice(idx, 1);

									if (command) recordApprovalResult(command, approvalResult);

									if (approvalResult === 'timeout') {
										toolResult = 'Command approval timed out';
										toolError = true;
									} else if (approvalResult === 'denied') {
										toolResult = 'Command denied by user';
										toolError = true;
									} else {
										try {
											const execResult = await executeTool(tc.function.name, args, project);
											toolResult = execResult.result;
											toolError = execResult.error ?? false;
											fileChanged = execResult.fileChanged;
											blockedPaths = execResult.blockedPaths ?? [];
										} catch (e) {
											toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
											toolError = true;
										}
									}
								} else {
									// Auto-approved command
									try {
										const execResult = await executeTool(tc.function.name, args, project);
										toolResult = execResult.result;
										toolError = execResult.error ?? false;
										fileChanged = execResult.fileChanged;
										blockedPaths = execResult.blockedPaths ?? [];
									} catch (e) {
										toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
										toolError = true;
									}
								}
							} else {
								try {
									const execResult = await executeTool(tc.function.name, args, project);
									toolResult = execResult.result;
									toolError = execResult.error ?? false;
									fileChanged = execResult.fileChanged;
								} catch (e) {
									toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
									toolError = true;
								}
							}

							// Wait for user to resolve sandbox blocked paths before returning result
							if (blockedPaths.length > 0) {
								const home = homedir();
								const displayPaths = blockedPaths.map((p) =>
									p.startsWith(home) ? '~' + p.slice(home.length) : p
								);
								const sandboxRequestId = crypto.randomUUID();
								controller.enqueue(
									new TextEncoder().encode(
										sseEvent(
											JSON.stringify({
												type: 'sandbox_blocked',
												requestId: sandboxRequestId,
												paths: displayPaths,
												absolutePaths: blockedPaths
											})
										)
									)
								);

								// Wait for user to allow or dismiss
								const sandboxResult = await requestSandboxResolution(sandboxRequestId);
								if (sandboxResult === 'allowed') {
									// Re-run the command with the new path exception
									try {
										const retryResult = await executeTool(tc.function.name, args, project);
										toolResult = retryResult.result;
										toolError = retryResult.error ?? false;
										fileChanged = retryResult.fileChanged;
										// Don't check blockedPaths again to avoid infinite loop
									} catch (e) {
										toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
										toolError = true;
									}
								}
								// If dismissed or timeout, the original error result is sent to the model
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
											content: toolResult,
											error: toolError
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

					// No tool calls: if content is empty, auto-retry once with a nudge
					if (!result.content.trim()) {
						if (!hasRetried) {
							hasRetried = true;
							messages.push({
								role: 'assistant',
								content: ''
							});
							messages.push({
								role: 'user',
								content: 'Continue with the next step.'
							});
							continue;
						}
						// Already retried, give up
						controller.enqueue(
							new TextEncoder().encode(
								sseEvent(
									JSON.stringify({
										type: 'delta',
										content:
											'[The model returned an empty response. This may indicate a context length issue or the model failing to generate output.]'
									})
								)
							)
						);
					}

					// Emit content in chunks for smoother UI
					const fullContent = result.reasoning
						? `<think>${result.reasoning}</think>${result.content}`
						: result.content;
					for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
						const chunk = fullContent.slice(i, i + CHUNK_SIZE);
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
