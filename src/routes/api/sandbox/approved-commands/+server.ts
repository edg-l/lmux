import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queryAll } from '$lib/server/db';
import { removeApprovedCommand } from '$lib/server/sandbox-rules';

export const GET: RequestHandler = async () => {
	const rows = queryAll<{ id: number; pattern: string; created_at: string }>(
		'SELECT id, pattern, created_at FROM approved_commands ORDER BY created_at DESC'
	);
	return json(rows);
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (typeof id !== 'number') {
		return json({ error: 'Missing id' }, { status: 400 });
	}
	removeApprovedCommand(id);
	return json({ ok: true });
};
