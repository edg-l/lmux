import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApproval, getApprovalCommand } from '$lib/server/approval-store';
import { addApprovedCommand, recordApprovalResult } from '$lib/server/sandbox-rules';

export const POST: RequestHandler = async ({ request }) => {
	const { requestId, approved, remember } = await request.json();
	if (!requestId || typeof approved !== 'boolean') {
		return json({ error: 'Missing requestId or approved' }, { status: 400 });
	}

	// Read command before resolving (resolving deletes the entry)
	const command = getApprovalCommand(requestId);

	const found = resolveApproval(requestId, approved);
	if (!found) {
		return json({ error: 'No pending approval found' }, { status: 404 });
	}

	if (command) {
		recordApprovalResult(command, approved ? 'approved' : 'denied');
		if (remember && approved) {
			addApprovedCommand(command);
		}
	}

	return json({ ok: true });
};
