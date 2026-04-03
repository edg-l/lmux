import type { SamplingParams } from '$lib/types/chat';

export const SAMPLING_DEFAULTS: SamplingParams = {
	temperature: 0.7,
	top_p: 0.95,
	top_k: 40,
	min_p: 0.05,
	repeat_penalty: 1.1
};

export async function loadSamplingParams(
	modelId: number
): Promise<(SamplingParams & { source: string }) | null> {
	try {
		const res = await fetch(`/api/models/${modelId}/sampling`);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

export async function saveSamplingDefaults(modelId: number, params: SamplingParams): Promise<void> {
	await fetch(`/api/models/${modelId}/sampling`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params)
	});
}

export async function fetchRecommendedSampling(
	modelId: number
): Promise<(SamplingParams & { source: string }) | { error: string }> {
	const res = await fetch(`/api/models/${modelId}/sampling`, { method: 'POST' });
	if (!res.ok) {
		const data = await res.json();
		return { error: data.error ?? 'Failed to fetch recommended params' };
	}
	return await res.json();
}

export function resetSampling(): SamplingParams {
	return { ...SAMPLING_DEFAULTS };
}
