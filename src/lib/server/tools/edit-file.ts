import { resolveProjectPath } from './path-utils';

export async function editProjectFile(
	args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
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

	const content = await file.text();

	// Count occurrences
	let count = 0;
	let searchFrom = 0;
	while (true) {
		const idx = content.indexOf(args.old_string, searchFrom);
		if (idx === -1) break;
		count++;
		searchFrom = idx + args.old_string.length;
	}

	if (count === 0) {
		return { result: 'old_string not found in file' };
	}

	if (count > 1 && !args.replace_all) {
		return {
			result: `old_string found ${count} times, expected exactly 1. Use replace_all or provide more context.`
		};
	}

	if (args.replace_all) {
		// Use split/join to avoid $ substitution patterns in String.replace
		const newContent = content.split(args.old_string).join(args.new_string);
		await Bun.write(resolved, newContent);
		return {
			result: `Replaced ${count} occurrences`,
			fileChanged: { path: args.path, operation: 'modified' }
		};
	}

	// Exactly 1 occurrence -- use slice to avoid $ substitution patterns
	const idx = content.indexOf(args.old_string);
	const lineNumber = content.substring(0, idx).split('\n').length;
	const newContent =
		content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
	await Bun.write(resolved, newContent);

	return {
		result: `Replaced 1 occurrence at line ${lineNumber}`,
		fileChanged: { path: args.path, operation: 'modified' }
	};
}
