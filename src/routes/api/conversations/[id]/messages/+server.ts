import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessages, addMessage, deleteMessagesFrom } from '$lib/server/conversations';

export const GET: RequestHandler = async ({ params }) => {
	const conversationId = parseInt(params.id);
	if (isNaN(conversationId)) return json({ error: 'Invalid id' }, { status: 400 });
	return json(getMessages(conversationId));
};

export const POST: RequestHandler = async ({ params, request }) => {
	const conversationId = parseInt(params.id);
	if (isNaN(conversationId)) return json({ error: 'Invalid id' }, { status: 400 });
	const body = (await request.json()) as {
		role: string;
		content?: string;
		tokenCount?: number;
		toolCallId?: string;
		toolCalls?: string;
		images?: string;
	};

	const validRoles = new Set(['user', 'assistant', 'tool', 'system']);
	if (!body.role || !validRoles.has(body.role)) {
		return json({ error: 'Missing or invalid role' }, { status: 400 });
	}

	const id = addMessage(
		conversationId,
		body.role,
		body.content ?? '',
		body.tokenCount,
		body.toolCallId,
		body.toolCalls,
		body.images
	);
	return json({ id }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const conversationId = parseInt(params.id);
	if (isNaN(conversationId)) return json({ error: 'Invalid id' }, { status: 400 });
	const body = (await request.json()) as { fromMessageId: number };

	if (!body.fromMessageId || typeof body.fromMessageId !== 'number') {
		return json({ error: 'Missing or invalid fromMessageId' }, { status: 400 });
	}

	deleteMessagesFrom(conversationId, body.fromMessageId);
	return json({ ok: true });
};
