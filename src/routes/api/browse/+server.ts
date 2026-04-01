import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

export const GET: RequestHandler = async ({ url }) => {
	const rawPath = url.searchParams.get('path') || homedir();
	const hidden = url.searchParams.get('hidden') === 'true';

	const resolved = resolve(rawPath);

	if (!existsSync(resolved)) {
		return json({ error: 'Path does not exist' }, { status: 400 });
	}

	let entries;
	try {
		entries = readdirSync(resolved, { withFileTypes: true });
	} catch {
		return json({ error: 'Cannot read directory' }, { status: 400 });
	}

	let directories = entries
		.filter((e) => {
			if (e.isDirectory()) return true;
			// Follow symlinks to check if they point to directories
			if (e.isSymbolicLink()) {
				try {
					return statSync(join(resolved, e.name)).isDirectory();
				} catch {
					return false;
				}
			}
			return false;
		})
		.map((e) => e.name);

	if (!hidden) {
		directories = directories.filter((name) => !name.startsWith('.'));
	}

	directories.sort((a, b) => a.localeCompare(b));

	return json({ path: resolved, directories });
};
