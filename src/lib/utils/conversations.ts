import type { Conversation, Message } from '$lib/types/chat';

export async function fetchConversations(): Promise<Conversation[]> {
	try {
		const res = await fetch('/api/conversations');
		if (res.ok) return await res.json();
	} catch {
		// ignore
	}
	return [];
}

export async function fetchConversation(id: number): Promise<Message[]> {
	try {
		const res = await fetch(`/api/conversations/${id}`);
		if (res.ok) {
			const data = await res.json();
			return data.messages ?? [];
		}
	} catch {
		// ignore
	}
	return [];
}

export async function createConversation(modelId: number, title: string): Promise<{ id: number }> {
	const res = await fetch('/api/conversations', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ title, modelId })
	});
	return await res.json();
}

export async function deleteConversation(id: number): Promise<void> {
	await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
}

export async function updateConversationTitle(id: number, title: string): Promise<void> {
	await fetch(`/api/conversations/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ title })
	});
}

export async function saveMessage(
	conversationId: number,
	role: string,
	content: string,
	opts?: {
		toolCallId?: string;
		toolCalls?: string;
		tokenCount?: number;
		images?: Array<{ name: string; dataUrl: string }>;
	}
): Promise<number | null> {
	try {
		const res = await fetch(`/api/conversations/${conversationId}/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				role,
				content,
				...(opts?.toolCallId && { toolCallId: opts.toolCallId }),
				...(opts?.toolCalls && { toolCalls: opts.toolCalls }),
				...(opts?.tokenCount != null && { tokenCount: opts.tokenCount }),
				...(opts?.images && { images: JSON.stringify(opts.images) })
			})
		});
		if (res.ok) {
			const data = await res.json();
			return data.id;
		}
	} catch {
		// ignore save failures
	}
	return null;
}
