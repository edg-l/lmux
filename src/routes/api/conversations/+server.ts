import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConversations, createConversation } from '$lib/server/conversations';

export const GET: RequestHandler = async () => {
	return json(listConversations());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { title?: string; modelId?: number };
	const id = createConversation(body.title, body.modelId);
	return json({ id }, { status: 201 });
};
