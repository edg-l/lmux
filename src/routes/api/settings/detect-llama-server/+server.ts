import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { detectLlamaServer } from '$lib/server/llama';

export const GET: RequestHandler = async () => {
	try {
		const path = await detectLlamaServer();
		if (path) {
			return json({ path });
		}
		return json({ path: null, error: 'llama-server not found in PATH' });
	} catch {
		return json({ path: null, error: 'Detection failed' });
	}
};
