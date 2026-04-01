import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/projects';
import { listProjectConversations, createConversation } from '$lib/server/conversations';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	return json(listProjectConversations(id));
};

export const POST: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	const body = (await request.json()) as { title?: string; modelId?: number };
	const convId = createConversation(body.title, body.modelId, id);
	return json({ id: convId }, { status: 201 });
};
