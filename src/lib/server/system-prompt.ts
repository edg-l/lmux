import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { getSetting } from './settings';
import { getModel } from './models';

const CODING_SYSTEM_PROMPT = `You are a coding assistant working on a project.

Project: {{project_name}}
Root: {{project_path}}
Date: {{date}} ({{day}})

You have tools to read, write, edit, and search files, and to run shell commands in the project directory. All file paths are relative to the project root.

Guidelines:
- Read files before modifying them to understand context
- Make minimal, focused changes
- Use edit_file for precise modifications to existing files
- Use write_file only for new files or complete rewrites
- Use run_command to build, test, and verify changes
- When editing, provide enough context in old_string to match uniquely`;

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
