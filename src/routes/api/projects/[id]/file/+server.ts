import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/projects';
import { resolveProjectPath } from '$lib/server/tools/path-utils';

const MAX_LINES = 10_000;

export const GET: RequestHandler = async ({ params, url }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Missing path parameter' }, { status: 400 });

	let resolved: string;
	try {
		resolved = resolveProjectPath(project.path, filePath);
	} catch {
		return json({ error: 'Invalid path' }, { status: 400 });
	}

	try {
		const raw = readFileSync(resolved, 'utf-8');
		const allLines = raw.split('\n');
		const totalLines = allLines.length;
		const truncated = totalLines > MAX_LINES;
		const content = truncated ? allLines.slice(0, MAX_LINES).join('\n') : raw;

		return json({ path: filePath, content, totalLines, truncated });
	} catch {
		return json({ error: 'File not found' }, { status: 404 });
	}
};
