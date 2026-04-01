import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject } from '$lib/server/projects';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const project = getProject(id);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });

	// Check if git repo
	const gitCheck = Bun.spawn(['git', 'rev-parse', '--git-dir'], {
		cwd: project.path,
		stdout: 'pipe',
		stderr: 'pipe'
	});
	await gitCheck.exited;
	if (gitCheck.exitCode !== 0) {
		return json({ isGit: false, files: [] });
	}

	// Get modified/new files from git status
	const proc = Bun.spawn(['git', 'status', '--porcelain', '-uall'], {
		cwd: project.path,
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	const files: Array<{ path: string; operation: 'created' | 'modified' }> = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		const status = line.substring(0, 2);
		const filePath = line.substring(3).trim();
		if (status === '??' || status.includes('A')) {
			files.push({ path: filePath, operation: 'created' });
		} else if (status.includes('M') || status.includes('D') || status.includes('R')) {
			files.push({ path: filePath, operation: 'modified' });
		}
	}

	return json({ isGit: true, files });
};
