import { queryAll, queryOne, execute } from './db';

export interface Conversation {
	id: number;
	title: string | null;
	model_id: number | null;
	model_name: string | null;
	project_id: number | null;
	tags: string;
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
	images: string | null;
	created_at: string;
}

export interface ImageData {
	name: string;
	dataUrl: string;
}

export interface Message {
	id: number;
	conversation_id: number;
	role: string;
	content: string;
	token_count: number | null;
	tool_call_id: string | null;
	tool_calls: ToolCallData[] | null;
	images: ImageData[] | null;
	created_at: string;
}

export function createConversation(title?: string, modelId?: number, projectId?: number): number {
	const result = execute(
		`INSERT INTO conversations (title, model_id, project_id) VALUES ($title, $model_id, $project_id)`,
		{
			$title: title ?? null,
			$model_id: modelId ?? null,
			$project_id: projectId ?? null
		}
	);
	return Number(result.lastInsertRowid);
}

export function listProjectConversations(projectId: number): Conversation[] {
	return queryAll<Conversation>(
		'SELECT c.*, m.filename as model_name FROM conversations c LEFT JOIN models m ON c.model_id = m.id WHERE c.project_id = $project_id ORDER BY c.updated_at DESC',
		{ $project_id: projectId }
	);
}

export function listConversations(): Conversation[] {
	return queryAll<Conversation>(
		'SELECT c.*, m.filename as model_name FROM conversations c LEFT JOIN models m ON c.model_id = m.id ORDER BY c.updated_at DESC'
	);
}

export function getConversation(id: number): Conversation | null {
	return queryOne<Conversation>(
		'SELECT c.*, m.filename as model_name FROM conversations c LEFT JOIN models m ON c.model_id = m.id WHERE c.id = $id',
		{ $id: id }
	);
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
	toolCalls?: string,
	images?: string
): number {
	const result = execute(
		`INSERT INTO messages (conversation_id, role, content, token_count, tool_call_id, tool_calls, images)
		 VALUES ($conversation_id, $role, $content, $token_count, $tool_call_id, $tool_calls, $images)`,
		{
			$conversation_id: conversationId,
			$role: role,
			$content: content,
			$token_count: tokenCount ?? null,
			$tool_call_id: toolCallId ?? null,
			$tool_calls: toolCalls ?? null,
			$images: images ?? null
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
		let images: ImageData[] | null = null;
		if (row.images) {
			try {
				images = JSON.parse(row.images);
			} catch {
				images = null;
			}
		}
		return { ...row, tool_calls: toolCalls, images };
	});
}

export function updateConversationModel(id: number, modelId: number): void {
	execute(
		'UPDATE conversations SET model_id = $model_id, updated_at = CURRENT_TIMESTAMP WHERE id = $id',
		{ $id: id, $model_id: modelId }
	);
}

export function deleteMessagesFrom(conversationId: number, messageId: number): void {
	execute('DELETE FROM messages WHERE conversation_id = $cid AND id >= $mid', {
		$cid: conversationId,
		$mid: messageId
	});
}

export function updateConversationTitle(id: number, title: string): void {
	execute(
		'UPDATE conversations SET title = $title, updated_at = CURRENT_TIMESTAMP WHERE id = $id',
		{ $id: id, $title: title }
	);
}

export function updateConversationTags(id: number, tags: string): void {
	execute('UPDATE conversations SET tags = $tags, updated_at = CURRENT_TIMESTAMP WHERE id = $id', {
		$id: id,
		$tags: tags
	});
}
