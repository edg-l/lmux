import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addWritablePath } from '$lib/server/sandbox-rules';

export const POST: RequestHandler = async ({ request }) => {
	const { path } = await request.json();
	if (!path || typeof path !== 'string') {
		return json({ error: 'Missing path' }, { status: 400 });
	}
	addWritablePath(path);
	return json({ ok: true });
};
