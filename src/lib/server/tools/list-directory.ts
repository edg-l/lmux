import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveProjectPath } from './path-utils';
import { loadGitignorePatterns, isIgnored } from './gitignore';

export async function listProjectDirectory(
	args: { path?: string; depth?: number },
	projectRoot: string
): Promise<string> {
	const subPath = args.path ?? '';
	const resolved = resolveProjectPath(projectRoot, subPath);
	const maxDepth = Math.min(Math.max(args.depth ?? 2, 1), 5);
	const patterns = loadGitignorePatterns(projectRoot);

	// Always ignore .git
	const allPatterns = ['.git', ...patterns];

	const lines: string[] = [];
	buildTree(resolved, projectRoot, allPatterns, 0, maxDepth, '', lines);

	if (lines.length === 0) {
		return 'Directory is empty or does not exist.';
	}

	return lines.join('\n');
}

function buildTree(
	dirPath: string,
	projectRoot: string,
	patterns: string[],
	currentDepth: number,
	maxDepth: number,
	prefix: string,
	lines: string[]
): void {
	let entries: { name: string; isDir: boolean }[];
	try {
		const names = readdirSync(dirPath);
		entries = names
			.map((name) => {
				const fullPath = join(dirPath, name);
				try {
					const stat = statSync(fullPath);
					return { name, isDir: stat.isDirectory() };
				} catch {
					return { name, isDir: false };
				}
			})
			.filter((entry) => {
				const rel = relative(projectRoot, join(dirPath, entry.name));
				return !isIgnored(rel, patterns, entry.isDir);
			})
			.sort((a, b) => {
				// Directories first, then alphabetical
				if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
	} catch {
		return;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const isLast = i === entries.length - 1;
		const connector = isLast ? '└── ' : '├── ';
		const icon = entry.isDir ? '📁 ' : '';

		lines.push(`${prefix}${connector}${icon}${entry.name}`);

		if (entry.isDir && currentDepth + 1 < maxDepth) {
			const childPrefix = prefix + (isLast ? '    ' : '│   ');
			buildTree(
				join(dirPath, entry.name),
				projectRoot,
				patterns,
				currentDepth + 1,
				maxDepth,
				childPrefix,
				lines
			);
		}
	}
}
