import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRunningProcesses, killAllProcesses } from '$lib/server/process-registry';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	return json(getRunningProcesses(id));
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	killAllProcesses(id);
	return json({ ok: true });
};
