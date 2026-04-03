import { resolveProjectPath } from './path-utils';

export async function readProjectFile(
	args: { path: string; offset?: number; line?: number; limit?: number },
	projectRoot: string
): Promise<string> {
	const resolved = resolveProjectPath(projectRoot, args.path);
	const file = Bun.file(resolved);

	if (!(await file.exists())) {
		return `File not found: ${args.path}`;
	}

	const text = await file.text();
	const allLines = text.split('\n');
	const totalLines = allLines.length;
	// line is 1-indexed, offset is 0-indexed. line takes priority.
	const offset = args.line != null ? Math.max(0, args.line - 1) : (args.offset ?? 0);
	const limit = args.limit ?? 200;

	const sliced = allLines.slice(offset, offset + limit);
	const startLine = offset + 1;
	const endLine = offset + sliced.length;

	const numbered = sliced
		.map((line, i) => {
			const lineNum = offset + i + 1;
			return `  ${lineNum} | ${line}`;
		})
		.join('\n');

	return `[lines ${startLine}-${endLine} of ${totalLines}]\n${numbered}`;
}
