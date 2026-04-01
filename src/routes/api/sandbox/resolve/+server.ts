import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveSandboxRequest } from '$lib/server/approval-store';

export const POST: RequestHandler = async ({ request }) => {
	const { requestId, allowed } = await request.json();
	if (!requestId || typeof requestId !== 'string') {
		return json({ error: 'Missing requestId' }, { status: 400 });
	}

	resolveSandboxRequest(requestId, allowed === true);
	return json({ ok: true });
};
