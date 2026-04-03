import type { PresetInfo } from '$lib/types/chat';

export async function loadPresets(): Promise<PresetInfo[]> {
	try {
		const res = await fetch('/api/presets');
		if (res.ok) return await res.json();
	} catch {
		// ignore
	}
	return [];
}

export async function savePreset(
	name: string,
	systemPrompt: string | null,
	params: {
		temperature: number;
		top_p: number;
		top_k: number;
		min_p: number;
		repeat_penalty: number;
		thinking_budget: number;
	}
): Promise<void> {
	await fetch('/api/presets', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name,
			system_prompt: systemPrompt,
			...params
		})
	});
}

export async function deletePreset(id: number): Promise<void> {
	await fetch(`/api/presets/${id}`, { method: 'DELETE' });
}

export async function setDefaultPreset(modelId: number, presetId: number | null): Promise<void> {
	await fetch(`/api/models/${modelId}/default-preset`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ preset_id: presetId })
	});
}

export async function getDefaultPresetId(modelId: number): Promise<number | null> {
	try {
		const res = await fetch(`/api/models/${modelId}/default-preset`);
		if (res.ok) {
			const data = await res.json();
			return data.default_preset_id;
		}
	} catch {
		// ignore
	}
	return null;
}
