import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApproval } from '$lib/server/approval-store';

export const POST: RequestHandler = async ({ request }) => {
	const { requestId, approved } = await request.json();
	if (!requestId || typeof approved !== 'boolean') {
		return json({ error: 'Missing requestId or approved' }, { status: 400 });
	}
	const found = resolveApproval(requestId, approved);
	if (!found) {
		return json({ error: 'No pending approval found' }, { status: 404 });
	}
	return json({ ok: true });
};
