import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConversation, deleteConversation, getMessages } from '$lib/server/conversations';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const conversation = getConversation(id);
	if (!conversation) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	const messages = getMessages(id);
	return json({ ...conversation, messages });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const conversation = getConversation(id);
	if (!conversation) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	deleteConversation(id);
	return json({ ok: true });
};
