import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApproval, getApprovalCommand } from '$lib/server/approval-store';
import { addApprovedCommand } from '$lib/server/sandbox-rules';

export const POST: RequestHandler = async ({ request }) => {
	const { requestId, approved, remember } = await request.json();
	if (!requestId || typeof approved !== 'boolean') {
		return json({ error: 'Missing requestId or approved' }, { status: 400 });
	}

	// Read command before resolving (resolving deletes the entry)
	const command = remember && approved ? getApprovalCommand(requestId) : undefined;

	const found = resolveApproval(requestId, approved);
	if (!found) {
		return json({ error: 'No pending approval found' }, { status: 404 });
	}

	if (command) {
		addApprovedCommand(command);
	}

	return json({ ok: true });
};
