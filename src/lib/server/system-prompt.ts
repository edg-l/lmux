import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { getSetting } from './settings';
import { getModel } from './models';

export const RETRIEVAL_SYSTEM_PROMPT = `You are a search assistant. Given a user request about a coding project, output 6-10 search terms (one per line) that would find the most relevant source files. Output ONLY the search terms, one per line. No numbering, no explanation.

Focus on: function names, file names, module names, API routes, class names, or distinctive strings that would appear in the relevant code.`;

export function parseSearchTerms(response: string): string[] {
	return response
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && line.length < 100)
		.slice(0, 10);
}

export function buildPlanningSystemPrompt(retrievalContext: string): string {
	let prompt = `You are a planning assistant. You have read-only tools: read_file, search_files, list_directory.

## CRITICAL INSTRUCTIONS

You work in two phases:

PHASE 1 - EXPLORE (mandatory, do this first):
Your FIRST responses MUST be tool calls. You MUST read the actual source files that are relevant to the user's request before writing any plan. Do NOT skip this. Do NOT write any plan text yet.
- Use list_directory to understand project structure
- Use search_files to find relevant code patterns, types, functions, enums, structs
- Use read_file to read the key files you find
- Read at least 8-10 relevant source files before proceeding to Phase 2
- For cross-cutting changes, read files in EVERY affected subsystem (frontend, IR, optimizer, register allocator, code generator, ABI, encoding, tests)
- Pay attention to what ALREADY EXISTS vs what is MISSING
- Look at existing naming conventions and patterns (e.g., if integer comparison uses Icmp(CondCode), float comparison should use Fcmp(CondCode), not separate FLt/FGt/FEq ops)
- The user's instructions about "do not edit" or "only write X" apply to the EXECUTION phase, not to you. You are a read-only planner. Always read files.

PHASE 2 - PLAN (only after exploring):
After you have read enough source files, produce your final plan as a plain text response (no tool calls).

## Required plan structure:

### What Already Exists
List specific functions, types, files, and infrastructure that already exist and are relevant. Reference exact names from the code you read. This prevents duplicate work.

### What's Missing (Gap Analysis)
List specific gaps, bugs, or missing pieces you found by reading the code. Reference exact file paths and function names.

### Implementation Steps
Numbered steps grouped into phases. Each step must:
- Be ONE atomic action
- Name the EXACT file(s) to modify (no "e.g." or "likely" or "possibly" or "identify the relevant")
- Name the specific function, type, or enum to change
- Follow existing naming conventions in the codebase for new types/ops/functions
- End phases with a checkpoint: run build/test command
- For complex tasks, you should have 15-30+ steps. A 5-step plan for a multi-subsystem change is too shallow.

### Risks and Edge Cases
List any tricky edge cases, compatibility concerns, or known limitations.

The final phase MUST be a verify-and-repair loop: run build/test, read errors, fix, re-run.`;

	if (retrievalContext) {
		prompt += `\n\n## Codebase Context\n${retrievalContext}`;
	}

	return prompt;
}

export function buildPlanInjectedPrompt(codingPrompt: string, planText: string): string {
	if (!planText.trim()) return codingPrompt;
	return `${codingPrompt}

## Your Plan
Follow this plan step by step. After completing all steps, summarize what you did.

${planText}`;
}

const CODING_SYSTEM_PROMPT = `You are a coding assistant working on a project.

Project: {{project_name}}
Root: {{project_path}}
Date: {{date}} ({{day}})

You have tools to read, write, edit, and search files, and to run shell commands in the project directory. All file paths are relative to the project root.

Guidelines:
- ALWAYS use read_file before edit_file or write_file to understand the file content and structure
- For large files, use read_file with offset/limit to paginate through the content. Check the [lines X-Y of TOTAL] header to know if more content remains.
- Make minimal, focused changes
- Use edit_file for precise modifications to existing files
- Use write_file only for new files or complete rewrites
- When editing, provide enough context in old_string to match uniquely
- Use start_process for long-running commands (servers, watchers) and stop_process to terminate them

Verify and repair:
- After making changes, ALWAYS run the relevant build or test command to check for errors
- If a command fails, read the error output carefully, fix the issue, and run the command again
- Do NOT stop until the build/tests pass or you have exhausted all reasonable fixes
- If the project has a test runner (e.g., bun test, npm test, cargo test), run it after changes
- If no tests exist, verify by running or compiling the code to check for syntax/runtime errors

Workflow:
- You can give intermediate updates to the user while continuing to work. If you write text explaining what you found or plan to do, the system will automatically let you continue.
- When you are completely done with the task, call the done tool to signal completion.`;

export function expandTemplateVars(
	template: string,
	modelName: string,
	project?: { name: string; path: string }
): string {
	const now = new Date();
	const replacements: Record<string, string> = {
		date: now.toISOString().split('T')[0],
		time: now.toTimeString().slice(0, 5),
		day: now.toLocaleDateString('en-US', { weekday: 'long' }),
		model: modelName.replace(/\.gguf$/i, ''),
		user: userInfo().username,
		project_name: project?.name ?? '',
		project_path: project?.path ?? ''
	};
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => replacements[key] ?? match);
}

export function resolveSystemPrompt(
	modelId: number | null,
	project?: { id: number; name: string; path: string }
): string | null {
	if (project) {
		let combined = CODING_SYSTEM_PROMPT;

		try {
			const agentsMd = readFileSync(join(project.path, 'AGENTS.md'), 'utf-8');
			combined += '\n\n' + agentsMd;
		} catch {
			// AGENTS.md not found, continue without it
		}

		const modelName = modelId ? (getModel(modelId)?.filename ?? 'unknown') : 'unknown';
		return expandTemplateVars(combined, modelName, project);
	}

	// Non-project: existing behavior
	if (modelId) {
		const model = getModel(modelId);
		if (model) {
			if (model.system_prompt === '') return null; // explicitly disabled
			if (model.system_prompt) return expandTemplateVars(model.system_prompt, model.filename);
			// null = fall through to global default
		}
	}

	const global = getSetting('system_prompt');
	if (!global) return null;

	const modelName = modelId ? (getModel(modelId)?.filename ?? 'unknown') : 'unknown';
	return expandTemplateVars(global, modelName);
}
