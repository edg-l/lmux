import { executeTool } from '$lib/server/tools';
import {
	requestApproval,
	cleanupApproval,
	requestSandboxResolution
} from '$lib/server/approval-store';
import { detectDangerousPatterns } from '$lib/server/danger-detect';
import { isLandlockAvailable } from '$lib/server/sandbox';
import { isCommandApproved, recordApprovalResult } from '$lib/server/sandbox-rules';
import { homedir } from 'node:os';

// Re-export cleanupApproval so callers can clean up pending approvals
export { cleanupApproval };

function sseEvent(data: string): string {
	return `data: ${data}\n\n`;
}

export async function executeToolCall(options: {
	toolCall: { id: string; name: string; arguments: string };
	project: { id: number; path: string } | null;
	controller: ReadableStreamDefaultController;
	encoder: TextEncoder;
	pendingApprovalIds: string[];
	signal: AbortSignal;
}): Promise<{
	result: string;
	error: boolean;
	fileChanged?: { path: string; operation: 'created' | 'modified'; oldContent?: string };
	images?: Array<{ name: string; dataUrl: string }>;
}> {
	const { toolCall, project, controller, encoder, pendingApprovalIds } = options;

	let args: Record<string, unknown>;
	try {
		args = JSON.parse(toolCall.arguments);
	} catch {
		args = {};
	}

	let toolResult: string;
	let toolError: boolean;
	let fileChanged:
		| { path: string; operation: 'created' | 'modified'; oldContent?: string }
		| undefined;
	let blockedPaths: string[] = [];
	let toolImages: Array<{ name: string; dataUrl: string }> = [];

	// Approval flow for run_command and start_process
	if (
		(toolCall.name === 'run_command' || toolCall.name === 'start_process') &&
		typeof args.command === 'string'
	) {
		const command = args.command;
		const autoApproved = isCommandApproved(command);

		if (!autoApproved) {
			const dangers = detectDangerousPatterns(command);
			const requestId = crypto.randomUUID();
			pendingApprovalIds.push(requestId);

			controller.enqueue(
				encoder.encode(
					sseEvent(
						JSON.stringify({
							type: 'approval_request',
							requestId,
							command,
							dangers,
							sandboxed: isLandlockAvailable()
						})
					)
				)
			);

			const approvalResult = await requestApproval(requestId, command);
			// Remove from pending list after resolution
			const idx = pendingApprovalIds.indexOf(requestId);
			if (idx !== -1) pendingApprovalIds.splice(idx, 1);

			if (command) recordApprovalResult(command, approvalResult);

			if (approvalResult === 'timeout') {
				toolResult = 'Command approval timed out';
				toolError = true;
			} else if (approvalResult === 'denied') {
				toolResult = 'Command denied by user';
				toolError = true;
			} else {
				try {
					const execResult = await executeTool(toolCall.name, args, project ?? undefined);
					toolResult = execResult.result;
					toolError = execResult.error ?? false;
					fileChanged = execResult.fileChanged;
					blockedPaths = execResult.blockedPaths ?? [];
					toolImages = execResult.images ?? [];
				} catch (e) {
					toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
					toolError = true;
				}
			}
		} else {
			// Auto-approved command
			try {
				const execResult = await executeTool(toolCall.name, args, project ?? undefined);
				toolResult = execResult.result;
				toolError = execResult.error ?? false;
				fileChanged = execResult.fileChanged;
				blockedPaths = execResult.blockedPaths ?? [];
				toolImages = execResult.images ?? [];
			} catch (e) {
				toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
				toolError = true;
			}
		}
	} else if (toolCall.name === 'run_code') {
		const lang = typeof args.language === 'string' ? args.language : 'unknown';
		const code = typeof args.code === 'string' ? args.code : '';
		const displayString = `[${lang}] ${code.slice(0, 500)}`;

		const requestId = crypto.randomUUID();
		pendingApprovalIds.push(requestId);

		controller.enqueue(
			encoder.encode(
				sseEvent(
					JSON.stringify({
						type: 'approval_request',
						requestId,
						command: displayString,
						dangers: [],
						sandboxed: isLandlockAvailable()
					})
				)
			)
		);

		const approvalResult = await requestApproval(requestId, displayString);
		const idx = pendingApprovalIds.indexOf(requestId);
		if (idx !== -1) pendingApprovalIds.splice(idx, 1);

		recordApprovalResult('run_code:' + lang, approvalResult);

		if (approvalResult === 'timeout') {
			toolResult = 'Code execution approval timed out';
			toolError = true;
		} else if (approvalResult === 'denied') {
			toolResult = 'Code execution denied by user';
			toolError = true;
		} else {
			try {
				const execResult = await executeTool(toolCall.name, args, project ?? undefined);
				toolResult = execResult.result;
				toolError = execResult.error ?? false;
				fileChanged = execResult.fileChanged;
				toolImages = execResult.images ?? [];
			} catch (e) {
				toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
				toolError = true;
			}
		}
	} else {
		try {
			const execResult = await executeTool(toolCall.name, args, project ?? undefined);
			toolResult = execResult.result;
			toolError = execResult.error ?? false;
			fileChanged = execResult.fileChanged;
			toolImages = execResult.images ?? [];
		} catch (e) {
			toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
			toolError = true;
		}
	}

	// Wait for user to resolve sandbox blocked paths before returning result
	if (blockedPaths.length > 0) {
		const home = homedir();
		const displayPaths = blockedPaths.map((p) =>
			p.startsWith(home) ? '~' + p.slice(home.length) : p
		);
		const sandboxRequestId = crypto.randomUUID();
		controller.enqueue(
			encoder.encode(
				sseEvent(
					JSON.stringify({
						type: 'sandbox_blocked',
						requestId: sandboxRequestId,
						paths: displayPaths,
						absolutePaths: blockedPaths
					})
				)
			)
		);

		// Wait for user to allow or dismiss
		const sandboxResult = await requestSandboxResolution(sandboxRequestId);
		if (sandboxResult === 'allowed') {
			// Re-run the command with the new path exception
			try {
				const retryResult = await executeTool(toolCall.name, args, project ?? undefined);
				toolResult = retryResult.result;
				toolError = retryResult.error ?? false;
				fileChanged = retryResult.fileChanged;
				toolImages = retryResult.images ?? [];
				// Don't check blockedPaths again to avoid infinite loop
			} catch (e) {
				toolResult = `Error: ${e instanceof Error ? e.message : 'tool execution failed'}`;
				toolError = true;
			}
		}
		// If dismissed or timeout, the original error result is sent to the model
	}

	if (fileChanged) {
		controller.enqueue(
			encoder.encode(
				sseEvent(
					JSON.stringify({
						type: 'file_changed',
						path: fileChanged.path,
						operation: fileChanged.operation
					})
				)
			)
		);
	}

	controller.enqueue(
		encoder.encode(
			sseEvent(
				JSON.stringify({
					type: 'tool_result',
					id: toolCall.id,
					name: toolCall.name,
					content: toolResult,
					error: toolError,
					...(toolImages.length > 0 && { images: toolImages })
				})
			)
		)
	);

	return {
		result: toolResult,
		error: toolError,
		fileChanged,
		...(toolImages.length > 0 && { images: toolImages })
	};
}
