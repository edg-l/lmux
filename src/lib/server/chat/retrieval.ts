import { consumeLlamaStream } from '$lib/server/tools/llama-stream';
import { RETRIEVAL_SYSTEM_PROMPT, parseSearchTerms } from '$lib/server/system-prompt';
import { searchProjectFiles } from '$lib/server/tools/search-files';
import { listProjectDirectory } from '$lib/server/tools/list-directory';
import { readProjectFile } from '$lib/server/tools/read-file';

export type Emit = (event: string, data: Record<string, unknown>) => void;

interface ChatMessage {
	role: string;
	content: string | Array<Record<string, unknown>>;
}

export async function performRetrieval(options: {
	project: { id: number; path: string };
	normalizedMessages: ChatMessage[];
	llamaUrl: string;
	samplingParams: Record<string, unknown>;
	thinkingBudget: number | undefined;
	signal: AbortSignal;
	emit: Emit;
}): Promise<string> {
	const { project, normalizedMessages, llamaUrl, samplingParams, thinkingBudget, signal, emit } =
		options;

	emit('retrieval_status', { status: 'searching' });

	let retrievalContext = '';
	try {
		// Get project directory tree
		const tree = await listProjectDirectory({ depth: 3 }, project.path);
		retrievalContext += `## Project Structure\n${tree}\n\n`;

		// Ask the model for search terms
		const retrievalMessages: ChatMessage[] = [
			{ role: 'system', content: RETRIEVAL_SYSTEM_PROMPT },
			...normalizedMessages
		];

		const retrievalRes = await fetch(`${llamaUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal,
			body: JSON.stringify({
				messages: retrievalMessages,
				stream: true,
				stream_options: { include_usage: true },
				max_tokens: 1024,
				...samplingParams,
				...(thinkingBudget != null && thinkingBudget > 0 && { thinking_budget: thinkingBudget })
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
					const results = await searchProjectFiles({ pattern: term }, project.path);
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
					const relPath = filePath.startsWith(project.path)
						? filePath.slice(project.path.length + 1)
						: filePath;
					const content = await readProjectFile({ path: relPath, limit: 50 }, project.path);
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

	emit('retrieval_status', { status: 'done' });

	return retrievalContext;
}
