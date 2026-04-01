import { json } from '@sveltejs/kit';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/projects';
import { resolveProjectPath } from '$lib/server/tools/path-utils';
import { loadGitignorePatterns, isIgnored } from '$lib/server/tools/gitignore';

export const GET: RequestHandler = async ({ params, url }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	const subPath = url.searchParams.get('path') ?? '';
	let resolved: string;
	try {
		resolved = resolveProjectPath(project.path, subPath);
	} catch {
		return json({ error: 'Invalid path' }, { status: 400 });
	}

	const patterns = ['.git', ...loadGitignorePatterns(project.path)];

	try {
		const dirents = readdirSync(resolved, { withFileTypes: true });
		const entries = dirents
			.map((d) => {
				let type: 'file' | 'directory' = d.isDirectory() ? 'directory' : 'file';
				if (d.isSymbolicLink()) {
					try {
						type = statSync(join(resolved, d.name)).isDirectory() ? 'directory' : 'file';
					} catch {
						type = 'file';
					}
				}
				return { name: d.name, type };
			})
			.filter((entry) => {
				const rel = relative(project.path, join(resolved, entry.name));
				return !isIgnored(rel, patterns, entry.type === 'directory');
			})
			.sort((a, b) => {
				if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});

		return json({ path: subPath, entries });
	} catch {
		return json({ error: 'Directory not found' }, { status: 404 });
	}
};
