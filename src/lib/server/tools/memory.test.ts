import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readdirSync, cpSync } from 'node:fs';
import {
	validateNoteFilename,
	listNotes,
	writeNote,
	readNote,
	deleteNote,
	buildMemoryContext,
	getNotesDir
} from './memory';

// Tests use the real notes dir. We back up existing notes before tests
// and restore them after so user data is not lost.
const notesDir = getNotesDir();
const backupDir = notesDir + '.test-backup';

beforeEach(() => {
	if (existsSync(notesDir)) {
		if (existsSync(backupDir)) rmSync(backupDir, { recursive: true });
		cpSync(notesDir, backupDir, { recursive: true });
		rmSync(notesDir, { recursive: true });
	}
});

afterEach(() => {
	if (existsSync(notesDir)) rmSync(notesDir, { recursive: true });
	if (existsSync(backupDir)) {
		cpSync(backupDir, notesDir, { recursive: true });
		rmSync(backupDir, { recursive: true });
	}
});

describe('validateNoteFilename', () => {
	it('accepts valid filenames', () => {
		expect(validateNoteFilename('notes.md')).toBeNull();
		expect(validateNoteFilename('MEMORY.md')).toBeNull();
		expect(validateNoteFilename('my-notes.md')).toBeNull();
		expect(validateNoteFilename('my_notes.md')).toBeNull();
		expect(validateNoteFilename('a123-test_file.md')).toBeNull();
	});

	it('rejects files not ending in .md', () => {
		expect(validateNoteFilename('notes.txt')).not.toBeNull();
		expect(validateNoteFilename('notes')).not.toBeNull();
	});

	it('rejects path traversal', () => {
		expect(validateNoteFilename('../notes.md')).not.toBeNull();
		expect(validateNoteFilename('sub/notes.md')).not.toBeNull();
	});

	it('rejects hidden files', () => {
		expect(validateNoteFilename('.hidden.md')).not.toBeNull();
	});

	it('rejects filenames over 100 chars', () => {
		const longName = 'a'.repeat(98) + '.md';
		expect(validateNoteFilename(longName)).not.toBeNull();
	});

	it('rejects backslash paths', () => {
		expect(validateNoteFilename('sub\\notes.md')).not.toBeNull();
	});

	it('rejects empty filename', () => {
		expect(validateNoteFilename('')).not.toBeNull();
	});
});

describe('listNotes', () => {
	it('returns empty array for nonexistent dir', () => {
		const result = listNotes();
		expect(result).toEqual([]);
	});
});

describe('writeNote + readNote round-trip', () => {
	it('writes and reads a note', () => {
		writeNote('test.md', 'Hello world');
		const content = readNote('test.md');
		expect(content).toBe('Hello world');
	});

	it('lists notes in sorted order', () => {
		writeNote('beta.md', 'b', 'Beta note');
		writeNote('alpha.md', 'a', 'Alpha note');
		const notes = listNotes();
		expect(notes).toContain('alpha.md');
		expect(notes).toContain('beta.md');
		expect(notes).toContain('MEMORY.md');
	});
});

describe('deleteNote', () => {
	it('returns descriptive string for nonexistent file', () => {
		mkdirSync(getNotesDir(), { recursive: true });
		const result = deleteNote('nope.md');
		expect(result).toContain('does not exist');
	});

	it('deletes an existing note', () => {
		writeNote('todelete.md', 'bye');
		const result = deleteNote('todelete.md');
		expect(result).toContain('Deleted');
		expect(listNotes()).not.toContain('todelete.md');
	});
});

describe('buildMemoryContext', () => {
	it('seeds default MEMORY.md template on first access', () => {
		const result = buildMemoryContext();
		expect(result).toContain('## Model Memory');
		expect(result).toContain('# Memory');
		expect(result).toContain('## Notes');
	});

	it('returns formatted context when MEMORY.md has custom content', () => {
		writeNote('MEMORY.md', 'User prefers short answers.');
		const result = buildMemoryContext();
		expect(result).toContain('## Model Memory');
		expect(result).toContain('User prefers short answers.');
	});

	it('auto-indexes notes written with summary', () => {
		writeNote('prefs.md', 'Details here', 'User preferences');
		const memory = readNote('MEMORY.md');
		expect(memory).toContain('- prefs.md: User preferences');
	});

	it('removes index entry when note is deleted', () => {
		writeNote('temp.md', 'Temporary note', 'Temporary data');
		let memory = readNote('MEMORY.md');
		expect(memory).toContain('- temp.md: Temporary data');
		deleteNote('temp.md');
		memory = readNote('MEMORY.md');
		expect(memory).not.toContain('temp.md');
	});
});
