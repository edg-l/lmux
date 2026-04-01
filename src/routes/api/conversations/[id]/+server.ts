import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getConversation,
	deleteConversation,
	getMessages,
	updateConversationModel
} from '$lib/server/conversations';
import { getModel } from '$lib/server/models';

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

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const conversation = getConversation(id);
	if (!conversation) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	const body = (await request.json()) as { model_id?: number };
	if (typeof body.model_id !== 'number') {
		return json({ error: 'Missing or invalid model_id' }, { status: 400 });
	}

	const model = getModel(body.model_id);
	if (!model) {
		return json({ error: 'Model not found' }, { status: 404 });
	}

	updateConversationModel(id, body.model_id);
	return json({ ok: true });
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
