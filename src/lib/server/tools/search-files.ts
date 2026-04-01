import { resolveProjectPath } from './path-utils';

export async function searchProjectFiles(
	args: { pattern: string; glob?: string; path?: string },
	projectRoot: string
): Promise<string> {
	const searchDir = args.path ? resolveProjectPath(projectRoot, args.path) : projectRoot;

	const rgArgs = ['rg', '--line-number', '--no-heading', '--color', 'never'];

	if (args.glob) {
		rgArgs.push('--glob', args.glob);
	}

	rgArgs.push(args.pattern, searchDir);

	const proc = Bun.spawn(rgArgs, {
		cwd: projectRoot,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;

	if (proc.exitCode !== 0 && !stdout) {
		if (proc.exitCode === 1) {
			return 'No matches found.';
		}
		return `Search error: ${stderr.trim()}`;
	}

	const lines = stdout.split('\n');
	if (lines.length > 50) {
		return lines.slice(0, 50).join('\n') + '\n[results truncated at 50 lines]';
	}

	return stdout.trim() || 'No matches found.';
}
