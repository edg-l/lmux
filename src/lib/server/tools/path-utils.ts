import { resolve, relative } from 'node:path';

export function resolveProjectPath(projectRoot: string, relativePath: string): string {
	const resolved = resolve(projectRoot, relativePath);
	const rel = relative(projectRoot, resolved);
	if (rel.startsWith('..') || resolve(projectRoot, rel) !== resolved) {
		throw new Error(`Path traversal denied: ${relativePath}`);
	}
	return resolved;
}
