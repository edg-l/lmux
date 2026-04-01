import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModel } from '$lib/server/models';
import { getSamplingParams, setSamplingParams } from '$lib/server/sampling';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

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
