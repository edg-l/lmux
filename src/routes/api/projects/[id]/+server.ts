import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, deleteProject } from '$lib/server/projects';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	return json(project);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	deleteProject(id);
	return json({ ok: true });
};
