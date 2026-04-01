import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopServer } from '$lib/server/llama';

export const POST: RequestHandler = async () => {
	try {
		await stopServer();
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to stop server';
		return json({ error: message }, { status: 500 });
	}
};
