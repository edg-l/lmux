import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPreset, updatePreset, deletePreset } from '$lib/server/presets';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const preset = getPreset(id);
	if (!preset) return json({ error: 'Preset not found' }, { status: 404 });

	return json(preset);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const preset = getPreset(id);
	if (!preset) return json({ error: 'Preset not found' }, { status: 404 });

	const body = await request.json();
	if (!body.name || typeof body.name !== 'string') {
		return json({ error: 'Name is required' }, { status: 400 });
	}

	updatePreset(id, {
		name: body.name,
		system_prompt: body.system_prompt ?? null,
		temperature: body.temperature ?? null,
		top_p: body.top_p ?? null,
		top_k: body.top_k ?? null,
		min_p: body.min_p ?? null,
		repeat_penalty: body.repeat_penalty ?? null,
		thinking_budget: body.thinking_budget ?? null
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const preset = getPreset(id);
	if (!preset) return json({ error: 'Preset not found' }, { status: 404 });

	deletePreset(id);
	return json({ ok: true });
};
