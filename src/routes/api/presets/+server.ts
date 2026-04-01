import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPresets, createPreset } from '$lib/server/presets';

export const GET: RequestHandler = async () => {
	const presets = listPresets();
	return json(presets);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	if (!body.name || typeof body.name !== 'string') {
		return json({ error: 'Name is required' }, { status: 400 });
	}

	const id = createPreset({
		name: body.name,
		system_prompt: body.system_prompt ?? null,
		temperature: body.temperature ?? null,
		top_p: body.top_p ?? null,
		top_k: body.top_k ?? null,
		min_p: body.min_p ?? null,
		repeat_penalty: body.repeat_penalty ?? null,
		thinking_budget: body.thinking_budget ?? null
	});

	return json({ id }, { status: 201 });
};
