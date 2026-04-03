import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	unlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.md$/;

const NOTES_DIR = join(homedir(), '.local', 'share', 'lmux', 'notes');

const DEFAULT_MEMORY_TEMPLATE = `# Memory

You have persistent memory that survives across conversations.

## How it works
- This file (MEMORY.md) is loaded into your context at the start of every conversation
- Use memory_write to save notes, memory_read to read them, memory_delete to remove them
- Filenames must end in .md (e.g. user-preferences.md, project-notes.md)
- When you write a note, a one-line summary is automatically added to the index below
- When you delete a note, its index entry is automatically removed

## Best practices
- Keep detailed information in separate notes (this file is injected into every conversation)
- Update notes when you learn important preferences or facts about the user
- Delete outdated notes to keep memory clean

## Notes
`;

export function getNotesDir(): string {
	return NOTES_DIR;
}

export function validateNoteFilename(filename: string): string | null {
	if (!filename) return 'Filename is required.';
	if (filename.length > 100) return 'Filename must be 100 characters or fewer.';
	if (!FILENAME_RE.test(filename)) {
		return 'Invalid filename. Must start with alphanumeric, contain only alphanumeric/dash/underscore, and end in .md.';
	}
	return null;
}

export function listNotes(): string[] {
	try {
		const entries = readdirSync(NOTES_DIR);
		return entries.filter((f) => f.endsWith('.md')).sort();
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
			return [];
		}
		throw e;
	}
}

export function readNote(filename: string): string {
	const filePath = join(NOTES_DIR, filename);
	try {
		return readFileSync(filePath, 'utf-8');
	} catch {
		throw new Error(`Note '${filename}' not found.`);
	}
}

function ensureMemoryFile(): void {
	mkdirSync(NOTES_DIR, { recursive: true });
	const memoryPath = join(NOTES_DIR, 'MEMORY.md');
	if (!existsSync(memoryPath)) {
		writeFileSync(memoryPath, DEFAULT_MEMORY_TEMPLATE, 'utf-8');
	}
}

function updateMemoryIndex(filename: string, summary: string): void {
	const memoryPath = join(NOTES_DIR, 'MEMORY.md');
	ensureMemoryFile();
	let content = readFileSync(memoryPath, 'utf-8');
	const entryPattern = new RegExp(`^- ${escapeRegex(filename)}:.*$`, 'm');
	const newEntry = `- ${filename}: ${summary.replace(/\n/g, ' ').trim()}`;
	if (entryPattern.test(content)) {
		content = content.replace(entryPattern, newEntry);
	} else {
		content = content.trimEnd() + '\n' + newEntry + '\n';
	}
	writeFileSync(memoryPath, content, 'utf-8');
}

function removeMemoryIndexEntry(filename: string): void {
	const memoryPath = join(NOTES_DIR, 'MEMORY.md');
	if (!existsSync(memoryPath)) return;
	let content = readFileSync(memoryPath, 'utf-8');
	const entryPattern = new RegExp(`^- ${escapeRegex(filename)}:.*\n?`, 'm');
	content = content.replace(entryPattern, '');
	writeFileSync(memoryPath, content, 'utf-8');
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function writeNote(filename: string, content: string, summary?: string): void {
	mkdirSync(NOTES_DIR, { recursive: true });
	writeFileSync(join(NOTES_DIR, filename), content, 'utf-8');
	if (filename !== 'MEMORY.md' && summary) {
		updateMemoryIndex(filename, summary);
	}
}

export function deleteNote(filename: string): string {
	const filePath = join(NOTES_DIR, filename);
	try {
		unlinkSync(filePath);
		if (filename !== 'MEMORY.md') {
			removeMemoryIndexEntry(filename);
		}
		return `Deleted '${filename}'.`;
	} catch {
		return `Note '${filename}' does not exist.`;
	}
}

const MAX_MEMORY_CONTEXT = 8 * 1024;

export function buildMemoryContext(): string {
	ensureMemoryFile();
	try {
		const content = readFileSync(join(NOTES_DIR, 'MEMORY.md'), 'utf-8');
		if (content.trim()) {
			if (content.length > MAX_MEMORY_CONTEXT) {
				return (
					'\n\n## Model Memory\n' +
					content.slice(0, MAX_MEMORY_CONTEXT) +
					'\n[...memory truncated, use memory_read for full content]'
				);
			}
			return '\n\n## Model Memory\n' + content;
		}
		return '';
	} catch {
		return '';
	}
}
