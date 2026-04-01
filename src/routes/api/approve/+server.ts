import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApproval, getApprovalCommandBeforeResolve } from '$lib/server/approval-store';
import { addApprovedCommand } from '$lib/server/sandbox-rules';

export const POST: RequestHandler = async ({ request }) => {
	const { requestId, approved, remember } = await request.json();
	if (!requestId || typeof approved !== 'boolean') {
		return json({ error: 'Missing requestId or approved' }, { status: 400 });
	}

	if (remember && approved) {
		const command = getApprovalCommandBeforeResolve(requestId);
		if (command) {
			addApprovedCommand(command);
		}
	}

	const found = resolveApproval(requestId, approved);
	if (!found) {
		return json({ error: 'No pending approval found' }, { status: 404 });
	}
	return json({ ok: true });
};
