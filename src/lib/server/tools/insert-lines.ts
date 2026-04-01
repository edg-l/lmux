import { resolveProjectPath } from './path-utils';

export async function insertProjectLines(
	args: { path: string; line: number; content: string },
	projectRoot: string
): Promise<{
	result: string;
	fileChanged?: { path: string; operation: 'modified' };
}> {
	const resolved = resolveProjectPath(projectRoot, args.path);
	const file = Bun.file(resolved);

	if (!(await file.exists())) {
		return { result: `File not found: ${args.path}` };
	}

	const text = await file.text();
	const lines = text.split('\n');

	const insertAt = Math.max(0, Math.min(args.line, lines.length));
	const newLines = args.content.split('\n');

	lines.splice(insertAt, 0, ...newLines);
	await Bun.write(resolved, lines.join('\n'));

	return {
		result: `Inserted ${newLines.length} lines at line ${insertAt}`,
		fileChanged: { path: args.path, operation: 'modified' }
	};
}
