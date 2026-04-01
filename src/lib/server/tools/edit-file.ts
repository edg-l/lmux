import { resolveProjectPath } from './path-utils';
import { diffLines as computeDiffLines } from 'diff';

function generateDiffSnippet(oldStr: string, newStr: string, lineNumber: number): string {
	const changes = computeDiffLines(oldStr, newStr);
	const diffLines: string[] = [`@@ line ${lineNumber} @@`];

	for (const change of changes) {
		const lines = change.value.replace(/\n$/, '').split('\n');
		for (const line of lines) {
			if (change.added) {
				diffLines.push(`+ ${line}`);
			} else if (change.removed) {
				diffLines.push(`- ${line}`);
			} else {
				diffLines.push(`  ${line}`);
			}
		}
	}

	// Truncate if too long
	const maxLines = 16;
	if (diffLines.length > maxLines) {
		const half = Math.floor(maxLines / 2);
		return [
			...diffLines.slice(0, half),
			`  ... (${diffLines.length - maxLines} more lines)`,
			...diffLines.slice(-half)
		].join('\n');
	}

	return diffLines.join('\n');
}

export async function editProjectFile(
	args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
	projectRoot: string
): Promise<{
	result: string;
	error?: boolean;
	fileChanged?: { path: string; operation: 'modified' };
}> {
	const resolved = resolveProjectPath(projectRoot, args.path);
	const file = Bun.file(resolved);

	if (!(await file.exists())) {
		return { result: `File not found: ${args.path}`, error: true };
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
		return { result: 'old_string not found in file', error: true };
	}

	if (count > 1 && !args.replace_all) {
		return {
			result: `old_string found ${count} times, expected exactly 1. Use replace_all or provide more context.`,
			error: true
		};
	}

	if (args.replace_all) {
		// Use split/join to avoid $ substitution patterns in String.replace
		const newContent = content.split(args.old_string).join(args.new_string);
		await Bun.write(resolved, newContent);
		// Show diff for first occurrence
		const firstIdx = content.indexOf(args.old_string);
		const lineNumber = content.substring(0, firstIdx).split('\n').length;
		const diff = generateDiffSnippet(args.old_string, args.new_string, lineNumber);
		return {
			result: `Replaced ${count} occurrences\n\n${diff}`,
			fileChanged: { path: args.path, operation: 'modified' }
		};
	}

	// Exactly 1 occurrence -- use slice to avoid $ substitution patterns
	const idx = content.indexOf(args.old_string);
	const lineNumber = content.substring(0, idx).split('\n').length;
	const newContent =
		content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
	await Bun.write(resolved, newContent);

	const diff = generateDiffSnippet(args.old_string, args.new_string, lineNumber);
	return {
		result: `Replaced 1 occurrence at line ${lineNumber}\n\n${diff}`,
		fileChanged: { path: args.path, operation: 'modified' }
	};
}
