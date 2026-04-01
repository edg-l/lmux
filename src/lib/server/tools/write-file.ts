import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveProjectPath } from './path-utils';

export async function writeProjectFile(
	args: { path: string; content: string },
	projectRoot: string
): Promise<{
	result: string;
	fileChanged?: { path: string; operation: 'created' | 'modified'; oldContent?: string };
}> {
	const resolved = resolveProjectPath(projectRoot, args.path);
	const file = Bun.file(resolved);
	const existed = await file.exists();

	let oldContent: string | undefined;
	if (existed) {
		const text = await file.text();
		if (text.length <= 512000) {
			oldContent = text;
		}
	}

	mkdirSync(dirname(resolved), { recursive: true });
	await Bun.write(resolved, args.content);

	const operation = existed ? 'modified' : 'created';
	return {
		result: `File ${operation}: ${args.path}`,
		fileChanged: { path: args.path, operation, ...(oldContent !== undefined && { oldContent }) }
	};
}
