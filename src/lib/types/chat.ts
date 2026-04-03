export interface ToolCallData {
	id: string;
	function: { name: string; arguments: string };
}

export interface DangerSegment {
	segment: string;
	label: string;
	startIndex: number;
	endIndex: number;
}

export interface ApprovalRequest {
	requestId: string;
	command: string;
	dangers: DangerSegment[];
	sandboxed: boolean;
	resolved: boolean;
	approved: boolean | null;
}

export interface SandboxBlocked {
	requestId?: string;
	paths: string[];
	absolutePaths: string[];
	resolved?: boolean;
	allowedPath?: string;
}

/**
 * The roles `tool_status`, `approval`, and `sandbox_blocked` are ephemeral
 * and never persisted to the database.
 */
export interface Message {
	id?: number;
	role: string;
	content: string;
	tool_calls?: ToolCallData[] | null;
	tool_call_id?: string | null;
	toolName?: string;
	toolArgs?: string;
	toolStatus?: 'running' | 'done';
	toolError?: boolean;
	approval?: ApprovalRequest;
	sandboxBlocked?: SandboxBlocked;
	images?: Array<{ name: string; dataUrl: string; base64?: string }>;
	plan?: string;
}

export interface PendingToolMessage {
	role: string;
	content: string;
	toolCalls?: string;
	toolCallId?: string;
	images?: Array<{ name: string; dataUrl: string }>;
}

export interface TokenUsage {
	prompt: number;
	completion: number;
	total: number;
}

export interface ServerInfo {
	status: string;
	modelId: number | null;
	modelName: string | null;
	port: number;
	contextSize: number | null;
	lastTokensPerSecond: number | null;
}

export interface Conversation {
	id: number;
	title: string | null;
	model_id: number | null;
	model_name: string | null;
	tags: string;
	created_at: string;
	updated_at: string;
}

export interface AvailableModel {
	id: number;
	filename: string;
}

export interface Project {
	id: number;
	name: string;
	path: string;
	created_at: string;
}

export interface SamplingParams {
	temperature: number;
	top_p: number;
	top_k: number;
	min_p: number;
	repeat_penalty: number;
}

export interface PresetInfo {
	id: number;
	name: string;
	system_prompt: string | null;
	temperature: number | null;
	top_p: number | null;
	top_k: number | null;
	min_p: number | null;
	repeat_penalty: number | null;
	thinking_budget: number | null;
}
