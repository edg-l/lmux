import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addWritablePath } from '$lib/server/sandbox-rules';
import { resolveSandboxRequest } from '$lib/server/approval-store';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Paths that must never be made writable
const BLOCKED_PATHS = [
	'/',
	'/etc',
	'/usr',
	'/bin',
	'/sbin',
	'/boot',
	'/lib',
	'/lib64',
	'/var',
	'/root',
	'/proc',
	'/sys',
	'/dev'
];

export const POST: RequestHandler = async ({ request }) => {
	const { path, requestId } = await request.json();
	if (!path || typeof path !== 'string') {
		return json({ error: 'Missing path' }, { status: 400 });
	}

	const resolved = resolve(path);
	const home = homedir();

	// Block the home directory itself (subdirs are ok)
	if (resolved === home || resolved === home + '/') {
		return json(
			{ error: 'Cannot allow write access to the entire home directory' },
			{ status: 403 }
		);
	}

	// Block system-critical paths
	for (const blocked of BLOCKED_PATHS) {
		if (resolved === blocked || resolved === blocked + '/') {
			return json({ error: `Cannot allow write access to ${blocked}` }, { status: 403 });
		}
	}

	addWritablePath(resolved);

	// Resolve the pending sandbox request so the server re-runs the command
	if (requestId && typeof requestId === 'string') {
		resolveSandboxRequest(requestId, true);
	}

	return json({ ok: true });
};
