import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModel } from '$lib/server/models';
import { getSamplingParams, setSamplingParams } from '$lib/server/sampling';
import { fetchGenerationConfig } from '$lib/server/huggingface';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	const sampling = getSamplingParams(id);
	return json(sampling);
};

export const POST: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });
	if (!model.hf_repo) {
		return json({ error: 'No HuggingFace repo linked to this model' }, { status: 400 });
	}

	const genConfig = await fetchGenerationConfig(model.hf_repo);
	if (!genConfig) {
		return json({ error: 'No generation_config.json found in repo' }, { status: 404 });
	}

	setSamplingParams(
		id,
		{
			temperature: genConfig.temperature,
			top_p: genConfig.top_p,
			top_k: genConfig.top_k,
			min_p: genConfig.min_p,
			repeat_penalty: genConfig.repetition_penalty
		},
		'huggingface'
	);

	const sampling = getSamplingParams(id);
	return json(sampling);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	const body = await request.json();
	setSamplingParams(id, body, 'user');

	const sampling = getSamplingParams(id);
	return json(sampling);
};
