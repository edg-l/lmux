import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveProjectPath } from './path-utils';
import { editProjectFile } from './edit-file';
import { readProjectFile } from './read-file';
import { insertProjectLines } from './insert-lines';
import { detectDangerousPatterns } from '../danger-detect';
import { isIgnored } from './gitignore';

// ---------------------------------------------------------------------------
// path-utils
// ---------------------------------------------------------------------------

describe('resolveProjectPath', () => {
	it('resolves a normal relative path correctly', () => {
		const root = '/project';
		const result = resolveProjectPath(root, 'src/main.ts');
		expect(result).toBe('/project/src/main.ts');
	});

	it('resolves a nested relative path correctly', () => {
		const root = '/project';
		const result = resolveProjectPath(root, 'src/lib/foo.ts');
		expect(result).toBe('/project/src/lib/foo.ts');
	});

	it('resolves a path with .. that stays within project', () => {
		const root = '/project';
		const result = resolveProjectPath(root, 'src/../package.json');
		expect(result).toBe('/project/package.json');
	});

	it('throws on path traversal with ../../etc/passwd', () => {
		const root = '/project';
		expect(() => resolveProjectPath(root, '../../etc/passwd')).toThrow('Path traversal denied');
	});

	it('throws on absolute path /etc/passwd', () => {
		const root = '/project';
		expect(() => resolveProjectPath(root, '/etc/passwd')).toThrow('Path traversal denied');
	});
});

// ---------------------------------------------------------------------------
// Helpers for file-based tests
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmp() {
	tmpDir = mkdtempSync(join(tmpdir(), 'lmux-test-'));
}

function teardownTmp() {
	rmSync(tmpDir, { recursive: true, force: true });
}

function writeFile(name: string, content: string) {
	const fullPath = join(tmpDir, name);
	const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

// ---------------------------------------------------------------------------
// edit-file
// ---------------------------------------------------------------------------

describe('editProjectFile', () => {
	beforeEach(setupTmp);
	afterEach(teardownTmp);

	it('successful single replacement returns line number', async () => {
		writeFile('hello.ts', 'line one\nline two\nline three\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'line two', new_string: 'LINE TWO' },
			tmpDir
		);
		expect(result.result).toMatch(/Replaced 1 occurrence at line/);
		expect(result.fileChanged).toMatchObject({ path: 'hello.ts', operation: 'modified' });
	});

	it('old_string not found returns error message', async () => {
		writeFile('hello.ts', 'line one\nline two\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'DOES NOT EXIST', new_string: 'x' },
			tmpDir
		);
		expect(result.result).toBe('old_string not found in file');
		expect(result.fileChanged).toBeUndefined();
	});

	it('multiple matches without replace_all returns ambiguity error with count', async () => {
		writeFile('hello.ts', 'foo\nfoo\nfoo\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'foo', new_string: 'bar' },
			tmpDir
		);
		expect(result.result).toMatch(/found 3 times/);
		expect(result.result).toMatch(/replace_all/);
		expect(result.fileChanged).toBeUndefined();
	});

	it('replace_all: true replaces all occurrences and returns count', async () => {
		writeFile('hello.ts', 'foo\nfoo\nfoo\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'foo', new_string: 'bar', replace_all: true },
			tmpDir
		);
		expect(result.result).toContain('Replaced 3 occurrences');
		expect(result.fileChanged).toMatchObject({ path: 'hello.ts', operation: 'modified' });
	});

	it('replacement string with $& is treated literally (no regex substitution)', async () => {
		writeFile('hello.ts', 'hello world\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'hello', new_string: '$& there' },
			tmpDir
		);
		expect(result.result).toMatch(/Replaced 1 occurrence at line/);

		const content = readFileSync(join(tmpDir, 'hello.ts'), 'utf-8');
		expect(content).toBe('$& there world\n');
	});

	it('replacement string with $1 is treated literally (no regex substitution)', async () => {
		writeFile('hello.ts', 'hello world\n');
		const result = await editProjectFile(
			{ path: 'hello.ts', old_string: 'hello', new_string: '$1 replaced' },
			tmpDir
		);
		expect(result.result).toMatch(/Replaced 1 occurrence at line/);

		const content = readFileSync(join(tmpDir, 'hello.ts'), 'utf-8');
		expect(content).toBe('$1 replaced world\n');
	});

	it('file not found returns error message', async () => {
		const result = await editProjectFile(
			{ path: 'nonexistent.ts', old_string: 'x', new_string: 'y' },
			tmpDir
		);
		expect(result.result).toMatch(/File not found/);
	});
});

// ---------------------------------------------------------------------------
// read-file
// ---------------------------------------------------------------------------

describe('readProjectFile', () => {
	beforeEach(setupTmp);
	afterEach(teardownTmp);

	it('reads a file with line numbers and [lines X-Y of N] header', async () => {
		writeFile('sample.ts', 'alpha\nbeta\ngamma\n');
		const result = await readProjectFile({ path: 'sample.ts' }, tmpDir);
		// 'alpha\nbeta\ngamma\n'.split('\n') => ['alpha','beta','gamma',''] => 4 lines
		expect(result).toMatch(/^\[lines 1-4 of 4\]/);
		expect(result).toContain('  1 | alpha');
		expect(result).toContain('  2 | beta');
		expect(result).toContain('  3 | gamma');
	});

	it('pagination with offset and limit works correctly', async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
		writeFile('ten.ts', lines);
		const result = await readProjectFile({ path: 'ten.ts', offset: 3, limit: 3 }, tmpDir);
		expect(result).toMatch(/^\[lines 4-6 of 10\]/);
		expect(result).toContain('  4 | line4');
		expect(result).toContain('  5 | line5');
		expect(result).toContain('  6 | line6');
		expect(result).not.toContain('line1');
		expect(result).not.toContain('line7');
	});

	it('file not found returns error string', async () => {
		const result = await readProjectFile({ path: 'missing.ts' }, tmpDir);
		expect(result).toMatch(/File not found/);
	});

	it('default limit of 200 lines applies', async () => {
		const lines = Array.from({ length: 300 }, (_, i) => `L${i + 1}`).join('\n');
		writeFile('big.ts', lines);
		const result = await readProjectFile({ path: 'big.ts' }, tmpDir);
		// Without a limit, only 200 lines should appear
		expect(result).toContain('  1 | L1');
		expect(result).toContain('  200 | L200');
		expect(result).not.toContain('  201 | L201');
		expect(result).toMatch(/^\[lines 1-200 of 300\]/);
	});
});

// ---------------------------------------------------------------------------
// insert-lines
// ---------------------------------------------------------------------------

describe('insertProjectLines', () => {
	beforeEach(setupTmp);
	afterEach(teardownTmp);

	it('insert at line 0 prepends content', async () => {
		writeFile('code.ts', 'line1\nline2\nline3');
		await insertProjectLines({ path: 'code.ts', line: 0, content: 'PREPENDED' }, tmpDir);
		const content = readFileSync(join(tmpDir, 'code.ts'), 'utf-8');
		expect(content.startsWith('PREPENDED\n')).toBe(true);
		expect(content).toContain('line1');
	});

	it('insert at line >= linecount appends content', async () => {
		writeFile('code.ts', 'line1\nline2\nline3');
		// 'line1\nline2\nline3'.split('\n') => 3 lines, inserting at 999 clamps to 3
		await insertProjectLines({ path: 'code.ts', line: 999, content: 'APPENDED' }, tmpDir);
		const content = readFileSync(join(tmpDir, 'code.ts'), 'utf-8');
		expect(content.endsWith('APPENDED')).toBe(true);
	});

	it('insert in the middle works correctly', async () => {
		writeFile('code.ts', 'line1\nline2\nline3');
		await insertProjectLines({ path: 'code.ts', line: 1, content: 'INSERTED' }, tmpDir);
		const content = readFileSync(join(tmpDir, 'code.ts'), 'utf-8');
		const parts = content.split('\n');
		expect(parts[0]).toBe('line1');
		expect(parts[1]).toBe('INSERTED');
		expect(parts[2]).toBe('line2');
		expect(parts[3]).toBe('line3');
	});

	it('returns correct result message and fileChanged', async () => {
		writeFile('code.ts', 'a\nb\nc');
		const result = await insertProjectLines(
			{ path: 'code.ts', line: 1, content: 'new line' },
			tmpDir
		);
		expect(result.result).toMatch(/Inserted 1 lines at line 1/);
		expect(result.fileChanged).toMatchObject({ path: 'code.ts', operation: 'modified' });
	});
});

// ---------------------------------------------------------------------------
// danger-detect
// ---------------------------------------------------------------------------

describe('detectDangerousPatterns', () => {
	it('detects rm -rf dist', () => {
		const matches = detectDangerousPatterns('rm -rf dist');
		expect(matches).toHaveLength(1);
		expect(matches[0].label).toBe('rm -rf');
	});

	it('returns empty array for safe command bun test', () => {
		const matches = detectDangerousPatterns('bun test');
		expect(matches).toHaveLength(0);
	});

	it('detects rm -rf in the middle of a chained command with correct indices', () => {
		const cmd = 'bun build && rm -rf dist && bun build';
		const matches = detectDangerousPatterns(cmd);
		expect(matches).toHaveLength(1);
		expect(matches[0].label).toBe('rm -rf');
		expect(matches[0].segment).toBe('rm -rf dist');
		// Segment text is ' rm -rf dist ', starting at index 12 (after 'bun build &&'), ending at 25
		expect(matches[0].startIndex).toBe(12);
		expect(matches[0].endIndex).toBe(25);
	});

	it('detects git checkout --', () => {
		const matches = detectDangerousPatterns('git checkout -- src/');
		expect(matches).toHaveLength(1);
		expect(matches[0].label).toBe('git checkout --');
	});

	it('detects git reset --hard', () => {
		const matches = detectDangerousPatterns('git reset --hard');
		expect(matches).toHaveLength(1);
		expect(matches[0].label).toBe('git reset --hard');
	});

	it('detects git push --force', () => {
		const matches = detectDangerousPatterns('git push --force origin main');
		expect(matches).toHaveLength(1);
		expect(matches[0].label).toBe('git push --force');
	});

	it('does NOT trigger when rm is not the first word', () => {
		const matches = detectDangerousPatterns('grep rm file.txt');
		expect(matches).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// gitignore
// ---------------------------------------------------------------------------

describe('isIgnored', () => {
	it('node_modules is ignored by node_modules/ pattern', () => {
		expect(isIgnored('node_modules', ['node_modules/'], true)).toBe(true);
	});

	it('node_modules file is NOT ignored by directory-only pattern', () => {
		// node_modules/ is directory-only, so a file named node_modules is not matched
		expect(isIgnored('node_modules', ['node_modules/'], false)).toBe(false);
	});

	it('src/app.ts is NOT ignored by node_modules/ pattern', () => {
		expect(isIgnored('src/app.ts', ['node_modules/'], false)).toBe(false);
	});

	it('negation pattern !important.log un-ignores a previously ignored path', () => {
		const patterns = ['*.log', '!important.log'];
		expect(isIgnored('important.log', patterns, false)).toBe(false);
	});

	it('*.log matches debug.log', () => {
		expect(isIgnored('debug.log', ['*.log'], false)).toBe(true);
	});

	it('*.log does not match src/debug.log as a whole path but matches the basename', () => {
		// The implementation matches against any segment, so src/debug.log should be caught
		expect(isIgnored('src/debug.log', ['*.log'], false)).toBe(true);
	});

	it('unrelated file is not ignored', () => {
		const patterns = ['*.log', 'node_modules/', 'dist/'];
		expect(isIgnored('src/app.ts', patterns, false)).toBe(false);
	});
});
