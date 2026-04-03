import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import { PLANNING_SYSTEM_PROMPT } from '$lib/server/system-prompt';
import type { Emit } from './retrieval';

interface ChatMessage {
	role: string;
	content: string | Array<Record<string, unknown>>;
}

const CHUNK_SIZE = 20;

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
		normalizedMessages,
		retrievalContext,
		llamaUrl,
		samplingParams,
		thinkingBudget,
		signal,
		emit
	} = options;

	// Build planning prompt with retrieval context
	const planningPrompt = retrievalContext
		? `${PLANNING_SYSTEM_PROMPT}\n\n## Codebase Context\n${retrievalContext}`
		: PLANNING_SYSTEM_PROMPT;

	const planMessages: ChatMessage[] = [
		{ role: 'system', content: planningPrompt },
		...normalizedMessages
	];

	const planRes = await fetch(`${llamaUrl}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		signal,
		body: JSON.stringify({
			messages: planMessages,
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: 4096,
			...samplingParams,
			...(thinkingBudget != null && thinkingBudget > 0 && { thinking_budget: thinkingBudget })
		})
	});

	if (planRes.ok && planRes.body) {
		const planResult = await consumeLlamaStream(planRes.body);
		const planText = planResult.content;

		// Emit plan chunks for UI streaming
		for (let i = 0; i < planText.length; i += CHUNK_SIZE) {
			const chunk = planText.slice(i, i + CHUNK_SIZE);
			emit('plan_delta', { content: chunk });
		}

		// Emit plan_done with full text
		emit('plan_done', { content: planText });

		return planText;
	}

	return '';
}
