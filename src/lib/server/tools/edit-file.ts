import { resolveProjectPath } from './path-utils';
import { diffLines as computeDiffLines } from 'diff';

function generateDiffSnippet(oldStr: string, newStr: string, lineNumber: number): string {
	const changes = computeDiffLines(oldStr, newStr);
	// Each line: "TYPE:LINENUM:CONTENT" where TYPE is +, -, or space
	const diffLines: string[] = [];
	let oldLine = lineNumber;
	let newLine = lineNumber;

	for (const change of changes) {
		const lines = change.value.replace(/\n$/, '').split('\n');
		for (const line of lines) {
			if (change.added) {
				diffLines.push(`+:${newLine}:${line}`);
				newLine++;
			} else if (change.removed) {
				diffLines.push(`-:${oldLine}:${line}`);
				oldLine++;
			} else {
				diffLines.push(` :${oldLine}:${line}`);
				oldLine++;
				newLine++;
			}
		}
	}

	// Strip common leading whitespace from content (after the type:linenum: prefix)
	let minIndent = Infinity;
	for (const line of diffLines) {
		const colonIdx = line.indexOf(':', 2); // skip "X:" to find second colon
		const content = line.slice(colonIdx + 1);
		if (content.trim().length === 0) continue;
		const indent = content.match(/^ */)?.[0].length ?? 0;
		minIndent = Math.min(minIndent, indent);
	}
	if (minIndent > 0 && minIndent < Infinity) {
		for (let i = 0; i < diffLines.length; i++) {
			const colonIdx = diffLines[i].indexOf(':', 2);
			diffLines[i] =
				diffLines[i].slice(0, colonIdx + 1) + diffLines[i].slice(colonIdx + 1 + minIndent);
		}
	}

	// Truncate if too long
	const maxLines = 16;
	if (diffLines.length > maxLines) {
		const half = Math.floor(maxLines / 2);
		return [
			...diffLines.slice(0, half),
			` :0:... (${diffLines.length - maxLines} more lines)`,
			...diffLines.slice(-half)
		].join('\n');
	}

	return diffLines.join('\n');
}

/**
 * Find the closest match in the file content by checking if the first non-empty
 * line of old_string exists somewhere. Returns the surrounding context.
 */
function findClosestMatch(
	content: string,
	oldString: string
): { line: number; snippet: string } | null {
	const oldLines = oldString.split('\n').filter((l) => l.trim().length > 0);
	if (oldLines.length === 0) return null;

	// Try the first non-empty line, then the longest line as search anchors
	const candidates = [
		oldLines[0].trim(),
		...oldLines
			.slice(1)
			.sort((a, b) => b.trim().length - a.trim().length)
			.map((l) => l.trim())
	];

	for (const needle of candidates) {
		if (needle.length < 8) continue; // skip short lines that match too broadly
		const idx = content.indexOf(needle);
		if (idx !== -1) {
			const lines = content.split('\n');
			const matchLine = content.substring(0, idx).split('\n').length;
			const start = Math.max(0, matchLine - 3);
			const end = Math.min(lines.length, matchLine + 5);
			const snippet = lines
				.slice(start, end)
				.map((l, i) => `${start + i + 1}: ${l}`)
				.join('\n');
			return { line: matchLine, snippet };
		}
	}

	return null;
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
		// Help the model by showing what's actually in the file near a partial match
		const hint = findClosestMatch(content, args.old_string);
		const msg = hint
			? `old_string not found in file. Did you mean this (around line ${hint.line})?\n\n${hint.snippet}`
			: `old_string not found in file. The file has ${content.split('\n').length} lines. Use read_file to check the actual content before retrying.`;
		return { result: msg, error: true };
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
