import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadGitignorePatterns(projectRoot: string): string[] {
	try {
		const content = readFileSync(join(projectRoot, '.gitignore'), 'utf-8');
		return content
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#'));
	} catch {
		return [];
	}
}

export function isIgnored(relativePath: string, patterns: string[], isDirectory: boolean): boolean {
	let ignored = false;

	for (const pattern of patterns) {
		if (pattern.startsWith('!')) {
			const negated = pattern.slice(1);
			if (matchPattern(relativePath, negated, isDirectory)) {
				ignored = false;
			}
		} else {
			if (matchPattern(relativePath, pattern, isDirectory)) {
				ignored = true;
			}
		}
	}

	return ignored;
}

function matchPattern(relativePath: string, pattern: string, isDirectory: boolean): boolean {
	// Directory-only pattern (trailing /)
	let dirOnly = false;
	if (pattern.endsWith('/')) {
		dirOnly = true;
		pattern = pattern.slice(0, -1);
	}

	if (dirOnly && !isDirectory) {
		return false;
	}

	// If pattern contains /, match against full path, otherwise match against basename
	const segments = relativePath.split('/');
	if (pattern.includes('/')) {
		return globMatch(relativePath, pattern);
	}

	// Match against any path segment for non-slash patterns, or the full path
	return segments.some((seg) => globMatch(seg, pattern)) || globMatch(relativePath, pattern);
}

function globMatch(text: string, pattern: string): boolean {
	// Convert glob to regex
	let regex = '';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '*') {
			if (pattern[i + 1] === '*') {
				regex += '.*';
				i++; // skip second *
				if (pattern[i + 1] === '/') i++; // skip trailing /
			} else {
				regex += '[^/]*';
			}
		} else if (c === '?') {
			regex += '[^/]';
		} else if ('.+^${}()|[]\\'.includes(c)) {
			regex += '\\' + c;
		} else {
			regex += c;
		}
	}

	return new RegExp(`^${regex}$`).test(text);
}
