import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModel, getDefaultPresetId, setDefaultPresetId } from '$lib/server/models';
import { getPreset } from '$lib/server/presets';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	return json({ default_preset_id: getDefaultPresetId(id) });
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	const body = await request.json();
	const presetId = body.preset_id ?? null;

	if (presetId !== null) {
		const preset = getPreset(presetId);
		if (!preset) return json({ error: 'Preset not found' }, { status: 404 });
	}

	setDefaultPresetId(id, presetId);
	return json({ default_preset_id: presetId });
};
