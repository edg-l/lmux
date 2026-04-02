import { queryAll, execute } from './db';

export function getWritablePaths(): string[] {
	return queryAll<{ path: string }>('SELECT path FROM sandbox_writable_paths').map((r) => r.path);
}

export function addWritablePath(path: string): void {
	execute('INSERT OR IGNORE INTO sandbox_writable_paths (path) VALUES ($path)', { $path: path });
}

export function removeWritablePath(id: number): void {
	execute('DELETE FROM sandbox_writable_paths WHERE id = $id', { $id: id });
}

export function getApprovedCommands(): string[] {
	return queryAll<{ pattern: string }>('SELECT pattern FROM approved_commands').map(
		(r) => r.pattern
	);
}

export function addApprovedCommand(pattern: string): void {
	execute('INSERT OR IGNORE INTO approved_commands (pattern) VALUES ($pattern)', { $pattern: pattern });
}

export function removeApprovedCommand(id: number): void {
	execute('DELETE FROM approved_commands WHERE id = $id', { $id: id });
}

export function isCommandApproved(command: string): boolean {
	const patterns = getApprovedCommands();
	return patterns.some((pattern) => matchesPattern(pattern, command));
}

function matchesPattern(pattern: string, command: string): boolean {
	if (pattern.includes('*')) {
		// Glob matching: escape all regex-special chars except *, then replace * with .*
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		const regexStr = escaped.replace(/\*/g, '.*');
		const regex = new RegExp(`^${regexStr}$`);
		return regex.test(command);
	}
	// Prefix matching: exact match OR command starts with "pattern "
	return command === pattern || command.startsWith(pattern + ' ');
}
