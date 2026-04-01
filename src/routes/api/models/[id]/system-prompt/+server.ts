import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModel } from '$lib/server/models';
import { execute } from '$lib/server/db';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	return json({ system_prompt: model.system_prompt });
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const model = getModel(id);
	if (!model) return json({ error: 'Model not found' }, { status: 404 });

	const body = (await request.json()) as { system_prompt: string | null };
	execute('UPDATE models SET system_prompt = $system_prompt WHERE id = $id', {
		$system_prompt: body.system_prompt ?? null,
		$id: id
	});

	return json({ ok: true });
};
