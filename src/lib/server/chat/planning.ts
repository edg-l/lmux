import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import { buildPlanningSystemPrompt } from '$lib/server/system-prompt';
import { PLANNER_TOOL_DEFINITIONS, executePlannerTool } from '$lib/server/tools';
import { listProjectDirectory } from '$lib/server/tools/list-directory';
import type { Emit } from './retrieval';

interface ChatMessage {
	role: string;
	content: string | Array<Record<string, unknown>>;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

const CHUNK_SIZE = 20;
const MAX_ITERATIONS = 30;
// Minimum unique files read before accepting a plan.
const MIN_FILES_READ = 5;

export function validatePlan(planText: string, userMessageLength: number): string {
	const stepCount = planText.split('\n').filter((line) => /^\d+\./.test(line.trim())).length;
	if (stepCount < 5 && userMessageLength > 100) {
		return `[Warning: This plan has only ${stepCount} steps for a complex request. Consider if more detail is needed.]\n\n${planText}`;
	}
	return planText;
}

export async function performPlanning(options: {
	project: { id: number; path: string; name: string };
	normalizedMessages: ChatMessage[];
	retrievalContext: string;
	llamaUrl: string;
	samplingParams: Record<string, unknown>;
	thinkingBudget: number | undefined;
	signal: AbortSignal;
	emit: Emit;
}): Promise<string> {
	const {
		project,
		normalizedMessages,
		retrievalContext,
		llamaUrl,
		samplingParams,
		thinkingBudget,
		signal,
		emit
	} = options;

	emit('retrieval_status', { status: 'planning' });

	// Count source files in project to cap the minimum read requirement
	let projectFileCount = MIN_FILES_READ;
	try {
		const tree = await listProjectDirectory({ depth: 10 }, project.path);
		// Count lines that look like files (have an extension), not directories
		projectFileCount = tree.split('\n').filter((l) => /\.\w+$/.test(l.trim())).length;
	} catch {
		// Fall back to default
	}
	const minFilesRequired = Math.min(MIN_FILES_READ, Math.max(1, projectFileCount));

	const systemPrompt = buildPlanningSystemPrompt(retrievalContext);
	const messages: ChatMessage[] = [
		{ role: 'system', content: systemPrompt },
		...normalizedMessages
	];

	let iterationsLeft = MAX_ITERATIONS;
	let partialContent = '';
	const filesRead = new Set<string>();
	let nudgeCount = 0;

	while (iterationsLeft > 0) {
		if (signal.aborted) break;

		const planRes = await fetch(`${llamaUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal,
			body: JSON.stringify({
				messages,
				stream: true,
				stream_options: { include_usage: true },
				...samplingParams,
				tools: PLANNER_TOOL_DEFINITIONS,
				reasoning_budget_tokens: thinkingBudget != null && thinkingBudget > 0 ? thinkingBudget : 0
			})
		});

		if (!planRes.ok || !planRes.body) {
			console.error(
				'[planning] LLM request failed:',
				planRes.status,
				await planRes.text().catch(() => '')
			);
			break;
		}

		const result = await consumeLlamaStream(planRes.body);

		// Detect raw JSON tool calls in content (same pattern as main chat loop)
		if (result.toolCalls.length === 0 && result.content.trim()) {
			try {
				const parsed = JSON.parse(result.content.trim());
				if (parsed.name && parsed.arguments) {
					const args =
						typeof parsed.arguments === 'string'
							? parsed.arguments
							: JSON.stringify(parsed.arguments);
					result.toolCalls.push({
						id: `tc_plan_${Date.now()}`,
						type: 'function',
						function: { name: parsed.name, arguments: args }
					});
					result.content = '';
				}
			} catch {
				// Not JSON, treat as final plan text
			}
		}

		if (result.toolCalls.length > 0) {
			// Append assistant message with tool calls
			messages.push({
				role: 'assistant',
				content: result.content || '',
				tool_calls: result.toolCalls
			});

			// Execute each tool call
			for (const tc of result.toolCalls) {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(tc.function.arguments);
				} catch {
					args = {};
				}

				emit('retrieval_status', { status: 'exploring' });

				const toolResult = await executePlannerTool(tc.function.name, args, project.path);

				// Emit planning_tool_call with result so UI can show what was explored
				emit('planning_tool_call', {
					name: tc.function.name,
					arguments: tc.function.arguments,
					result_preview: toolResult.slice(0, 200)
				});

				// Track which files were read
				if (tc.function.name === 'read_file' && args.path) {
					filesRead.add(String(args.path));
				}

				// Append tool result to messages
				messages.push({
					role: 'tool',
					content: toolResult,
					tool_call_id: tc.id
				});
			}

			if (result.content) {
				partialContent += result.content;
			}

			iterationsLeft--;
			continue;
		}

		// Text-only response: check if model explored enough before accepting as final plan
		if (filesRead.size < minFilesRequired && nudgeCount < 3 && iterationsLeft > 1) {
			nudgeCount++;
			messages.push({ role: 'assistant', content: result.content });

			// Escalating nudges that suggest different exploration directions
			const remaining = minFilesRequired - filesRead.size;
			const nudges = [
				`You have only read ${filesRead.size} file(s) so far. That is not enough to write a thorough plan. Use read_file and search_files to explore MORE source files. Look at the project structure with list_directory if you haven't yet, then read files in different subsystems (not just the ones you already read).`,
				`You still have not read enough files (${filesRead.size} read, need at least ${minFilesRequired}). Your plan will be shallow without understanding the full codebase. Search for and read files related to parts you haven't explored yet: code generation, register allocation, ABI/calling conventions, frontend/parser, test infrastructure. Use search_files to find relevant code.`,
				`Last chance to explore before your plan is accepted. You've read ${filesRead.size} files. Read at least ${remaining} more file(s) in areas you haven't looked at yet. Focus on the subsystems your plan will need to change.`
			];
			messages.push({
				role: 'user',
				content: nudges[Math.min(nudgeCount - 1, nudges.length - 1)]
			});

			if (result.content) {
				partialContent += result.content;
			}
			iterationsLeft--;
			continue;
		}

		// Get user message length for validation heuristic
		const userMsgLength = normalizedMessages
			.filter((m) => m.role === 'user')
			.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
		const planText = validatePlan(result.content, userMsgLength);

		// Emit plan chunks for UI streaming
		for (let i = 0; i < planText.length; i += CHUNK_SIZE) {
			const chunk = planText.slice(i, i + CHUNK_SIZE);
			emit('plan_delta', { content: chunk });
		}

		emit('plan_done', { content: planText });
		emit('retrieval_status', { status: 'done' });

		return planText;
	}

	// Max iterations reached or aborted: return whatever partial content exists
	const fallback = partialContent || '';
	if (fallback) {
		for (let i = 0; i < fallback.length; i += CHUNK_SIZE) {
			const chunk = fallback.slice(i, i + CHUNK_SIZE);
			emit('plan_delta', { content: chunk });
		}
	}
	emit('plan_done', { content: fallback });
	emit('retrieval_status', { status: 'done' });

	return fallback;
}
