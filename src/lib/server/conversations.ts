import { queryAll, queryOne, execute } from './db';

export interface Conversation {
	id: number;
	title: string | null;
	model_id: number | null;
	created_at: string;
	updated_at: string;
}

export interface ToolCallData {
	id: string;
	function: { name: string; arguments: string };
}

interface MessageRow {
	id: number;
	conversation_id: number;
	role: string;
	content: string;
	token_count: number | null;
	tool_call_id: string | null;
	tool_calls: string | null;
	created_at: string;
}

export interface Message {
	id: number;
	conversation_id: number;
	role: string;
	content: string;
	token_count: number | null;
	tool_call_id: string | null;
	tool_calls: ToolCallData[] | null;
	created_at: string;
}

export function createConversation(title?: string, modelId?: number): number {
	const result = execute(`INSERT INTO conversations (title, model_id) VALUES ($title, $model_id)`, {
		$title: title ?? null,
		$model_id: modelId ?? null
	});
	return Number(result.lastInsertRowid);
}

export function listConversations(): Conversation[] {
	return queryAll<Conversation>('SELECT * FROM conversations ORDER BY updated_at DESC');
}

export function getConversation(id: number): Conversation | null {
	return queryOne<Conversation>('SELECT * FROM conversations WHERE id = $id', { $id: id });
}

export function deleteConversation(id: number): void {
	execute('DELETE FROM conversations WHERE id = $id', { $id: id });
}

export function addMessage(
	conversationId: number,
	role: string,
	content: string,
	tokenCount?: number,
	toolCallId?: string,
	toolCalls?: string
): number {
	const result = execute(
		`INSERT INTO messages (conversation_id, role, content, token_count, tool_call_id, tool_calls)
		 VALUES ($conversation_id, $role, $content, $token_count, $tool_call_id, $tool_calls)`,
		{
			$conversation_id: conversationId,
			$role: role,
			$content: content,
			$token_count: tokenCount ?? null,
			$tool_call_id: toolCallId ?? null,
			$tool_calls: toolCalls ?? null
		}
	);

	// Update conversation's updated_at timestamp
	execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $id', {
		$id: conversationId
	});

	return Number(result.lastInsertRowid);
}

export function getMessages(conversationId: number): Message[] {
	const rows = queryAll<MessageRow>(
		'SELECT * FROM messages WHERE conversation_id = $conversation_id ORDER BY created_at ASC, id ASC',
		{ $conversation_id: conversationId }
	);
	return rows.map((row) => {
		let toolCalls: ToolCallData[] | null = null;
		if (row.tool_calls) {
			try {
				toolCalls = JSON.parse(row.tool_calls);
			} catch {
				toolCalls = null;
			}
		}
		return { ...row, tool_calls: toolCalls };
	});
}

export function updateConversationTitle(id: number, title: string): void {
	execute(
		'UPDATE conversations SET title = $title, updated_at = CURRENT_TIMESTAMP WHERE id = $id',
		{ $id: id, $title: title }
	);
}
