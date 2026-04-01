import { userInfo } from 'node:os';
import { getSetting } from './settings';
import { getModel } from './models';

export function expandTemplateVars(template: string, modelName: string): string {
	const now = new Date();
	const replacements: Record<string, string> = {
		date: now.toISOString().split('T')[0],
		time: now.toTimeString().slice(0, 5),
		day: now.toLocaleDateString('en-US', { weekday: 'long' }),
		model: modelName.replace(/\.gguf$/i, ''),
		user: userInfo().username
	};
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => replacements[key] ?? match);
}

export function resolveSystemPrompt(modelId: number | null): string | null {
	// Check per-model override
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
