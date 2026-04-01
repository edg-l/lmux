import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProjects, createProject, getProject } from '$lib/server/projects';

export const GET: RequestHandler = async () => {
	return json(listProjects());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { name: string; path: string };
	const id = createProject(body.name, body.path);
	const project = getProject(id);
	return json(project);
};
