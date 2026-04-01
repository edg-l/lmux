export type ApprovalResult = 'approved' | 'denied' | 'timeout';

interface PendingApproval {
	resolve: (result: ApprovalResult) => void;
	timer: Timer;
	command?: string;
}

const pending = new Map<string, PendingApproval>();
const APPROVAL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function requestApproval(requestId: string, command?: string): Promise<ApprovalResult> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(requestId);
			resolve('timeout');
		}, APPROVAL_TIMEOUT);
		pending.set(requestId, { resolve, timer, command });
	});
}

export function getApprovalCommand(requestId: string): string | undefined {
	return pending.get(requestId)?.command;
}

export function resolveApproval(requestId: string, approved: boolean): boolean {
	const entry = pending.get(requestId);
	if (!entry) return false;
	clearTimeout(entry.timer);
	pending.delete(requestId);
	entry.resolve(approved ? 'approved' : 'denied');
	return true;
}

export function cleanupApproval(requestId: string): void {
	const entry = pending.get(requestId);
	if (entry) {
		clearTimeout(entry.timer);
		pending.delete(requestId);
		entry.resolve('denied');
	}
}
