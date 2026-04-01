import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessages, addMessage } from '$lib/server/conversations';

export const GET: RequestHandler = async ({ params }) => {
	const conversationId = parseInt(params.id);
	if (isNaN(conversationId)) return json({ error: 'Invalid id' }, { status: 400 });
	return json(getMessages(conversationId));
};

export const POST: RequestHandler = async ({ params, request }) => {
	const conversationId = parseInt(params.id);
	if (isNaN(conversationId)) return json({ error: 'Invalid id' }, { status: 400 });
	const body = (await request.json()) as { role: string; content: string; tokenCount?: number };

	if (!body.role || !body.content) {
		return json({ error: 'Missing role or content' }, { status: 400 });
	}

	const id = addMessage(conversationId, body.role, body.content, body.tokenCount);
	return json({ id }, { status: 201 });
};
