import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/projects';
import { resolveProjectPath } from '$lib/server/tools/path-utils';

export const GET: RequestHandler = async ({ params, url }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Missing path parameter' }, { status: 400 });

	try {
		resolveProjectPath(project.path, filePath);
	} catch {
		return json({ error: 'Invalid path' }, { status: 400 });
	}

	// Check if project is a git repo
	const gitCheck = Bun.spawn(['git', 'rev-parse', '--git-dir'], {
		cwd: project.path,
		stdout: 'pipe',
		stderr: 'pipe'
	});
	await gitCheck.exited;
	if (gitCheck.exitCode !== 0) {
		return json({ error: 'Not a git repository', diff: null });
	}

	// Get git diff for the file
	const proc = Bun.spawn(['git', 'diff', '--', filePath], {
		cwd: project.path,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	if (!stdout.trim()) {
		// No unstaged changes -- try staged diff
		const stagedProc = Bun.spawn(['git', 'diff', '--cached', '--', filePath], {
			cwd: project.path,
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const stagedOut = await new Response(stagedProc.stdout).text();
		await stagedProc.exited;

		if (!stagedOut.trim()) {
			return json({ diff: null });
		}
		return json({ diff: stagedOut });
	}

	return json({ diff: stdout });
};
