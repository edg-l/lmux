import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queryAll } from '$lib/server/db';
import { removeWritablePath } from '$lib/server/sandbox-rules';

export const GET: RequestHandler = async () => {
	const rows = queryAll<{ id: number; path: string; created_at: string }>(
		'SELECT id, path, created_at FROM sandbox_writable_paths ORDER BY created_at DESC'
	);
	return json(rows);
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (typeof id !== 'number') {
		return json({ error: 'Missing id' }, { status: 400 });
	}
	removeWritablePath(id);
	return json({ ok: true });
};
