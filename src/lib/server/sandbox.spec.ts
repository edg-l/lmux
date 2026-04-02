import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// In-memory DB mock for sandbox-rules tests.
//
// mock.module must be called BEFORE the target module is imported.
// We use dynamic imports below so the mock is in place first.
//
// Note: Bun's SQLite requires $-prefixed keys in the params object to match
// $named placeholders (e.g. { $path: '/foo' } for VALUES ($path)).
// The production db.ts passes plain keys ({ path: '/foo' }), which is a
// param-binding bug that causes INSERTs to silently no-op in production.
// The mock corrects for this so we can test the sandbox-rules logic itself.
// ---------------------------------------------------------------------------

const testDb = new Database(':memory:');
testDb.run(`CREATE TABLE IF NOT EXISTS sandbox_writable_paths (
	id INTEGER PRIMARY KEY,
	path TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (datetime())
)`);
testDb.run(`CREATE TABLE IF NOT EXISTS approved_commands (
	id INTEGER PRIMARY KEY,
	pattern TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (datetime())
)`);

/** Add the $ prefix that Bun SQLite requires for named parameters. */
function prefixParams(params: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(params)) {
		out[k.startsWith('$') ? k : `$${k}`] = v;
	}
	return out;
}

mock.module('/data2/edgar/lmux/src/lib/server/db.ts', () => ({
	queryAll: <T>(sql: string, params: Record<string, unknown> = {}): T[] =>
		testDb.prepare(sql).all(prefixParams(params) as never) as T[],
	queryOne: <T>(sql: string, params: Record<string, unknown> = {}): T | null =>
		(testDb.prepare(sql).get(prefixParams(params) as never) as T) ?? null,
	execute: (sql: string, params: Record<string, unknown> = {}) =>
		testDb.prepare(sql).run(prefixParams(params) as never)
}));

// Dynamic imports so the mock above is already registered when these modules load.
const { buildSandboxedCommand, parsePermissionDeniedPaths, isLandlockAvailable } = await import(
	'./sandbox.ts'
);
const {
	getWritablePaths,
	addWritablePath,
	removeWritablePath,
	getApprovedCommands,
	addApprovedCommand,
	removeApprovedCommand,
	isCommandApproved
} = await import('./sandbox-rules.ts');

// ---------------------------------------------------------------------------
// buildSandboxedCommand – unsandboxed path (landlock absent)
// ---------------------------------------------------------------------------

describe('buildSandboxedCommand (no landlock)', () => {
	it('returns bash -c wrapper when landlock is unavailable', () => {
		if (isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'echo hello');
		expect(result.sandboxed).toBe(false);
		expect(result.args).toEqual(['bash', '-c', 'echo hello']);
	});

	it('unsandboxed args contain the command verbatim', () => {
		if (isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/my/project', 'bun test --watch');
		expect(result.args[result.args.length - 1]).toBe('bun test --watch');
	});

	it('unsandboxed result ignores extraWritablePaths parameter', () => {
		if (isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'ls', ['/extra/path']);
		expect(result.sandboxed).toBe(false);
		expect(result.args).toHaveLength(3);
	});

	it('unsandboxed args length is always 3 regardless of project path', () => {
		if (isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/very/deep/project/path', 'cargo build');
		expect(result.args).toHaveLength(3);
		expect(result.args[0]).toBe('bash');
		expect(result.args[1]).toBe('-c');
	});
});

// ---------------------------------------------------------------------------
// buildSandboxedCommand – sandboxed path (landlock present)
// ---------------------------------------------------------------------------

describe('buildSandboxedCommand (with landlock)', () => {
	it('returns sandboxed: true and landlock-restrict as first arg when available', () => {
		if (!isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'echo hi');
		expect(result.sandboxed).toBe(true);
		expect(result.args[0]).toBe('landlock-restrict');
	});

	it('always includes projectPath and /tmp as writable when sandboxed', () => {
		if (!isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/my/project', 'ls');
		const joined = result.args.join(' ');
		expect(joined).toContain('-rw +refer /my/project');
		expect(joined).toContain('-rw +refer /tmp');
	});

	it('includes -rwfiles /dev/null when sandboxed', () => {
		if (!isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'ls');
		const joined = result.args.join(' ');
		expect(joined).toContain('-rwfiles /dev/null');
	});

	it('root filesystem mounted read-only via -ro /', () => {
		if (!isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'ls');
		const joined = result.args.join(' ');
		expect(joined).toContain('-ro /');
	});

	it('command appears as the last arg after --', () => {
		if (!isLandlockAvailable()) return;
		const result = buildSandboxedCommand('/project', 'echo hello');
		const dashIdx = result.args.indexOf('--');
		expect(dashIdx).toBeGreaterThan(-1);
		expect(result.args[result.args.length - 1]).toBe('echo hello');
	});
});

// ---------------------------------------------------------------------------
// buildSandboxedCommand – extraWritablePaths handling
// ---------------------------------------------------------------------------

describe('buildSandboxedCommand extraWritablePaths', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lmux-sandbox-test-'));
	});

	it('skips non-existent extra paths without throwing', () => {
		const result = buildSandboxedCommand('/project', 'ls', ['/does/not/exist/at/all']);
		expect(result).toBeTruthy();
	});

	it('multiple non-existent extra paths are all silently skipped', () => {
		const result = buildSandboxedCommand('/project', 'ls', [
			'/no/such/path/a',
			'/no/such/path/b'
		]);
		expect(result).toBeTruthy();
	});

	it('includes an existing directory as -rw when sandboxed', () => {
		if (!isLandlockAvailable()) {
			rmSync(tmpDir, { recursive: true, force: true });
			return;
		}
		const result = buildSandboxedCommand('/project', 'ls', [tmpDir]);
		expect(result.args.join(' ')).toContain(`-rw +refer ${tmpDir}`);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('includes an existing file as -rwfiles when sandboxed', () => {
		if (!isLandlockAvailable()) {
			rmSync(tmpDir, { recursive: true, force: true });
			return;
		}
		const filePath = join(tmpDir, 'secret.txt');
		writeFileSync(filePath, 'data');
		const result = buildSandboxedCommand('/project', 'ls', [filePath]);
		expect(result.args.join(' ')).toContain(`-rwfiles ${filePath}`);
		rmSync(tmpDir, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// parsePermissionDeniedPaths
// ---------------------------------------------------------------------------

describe('parsePermissionDeniedPaths', () => {
	it('returns empty array for empty string', () => {
		expect(parsePermissionDeniedPaths('')).toHaveLength(0);
	});

	it('returns empty array when no permission denied messages present', () => {
		expect(parsePermissionDeniedPaths('Everything is fine\nNo errors here')).toHaveLength(0);
	});

	it('parses a simple single-quoted path', () => {
		const paths = parsePermissionDeniedPaths("open '/var/log/app.log': Permission denied");
		expect(paths).toContain('/var/log');
	});

	it('parses an unquoted path', () => {
		const paths = parsePermissionDeniedPaths('/var/log/app.log: Permission denied');
		expect(paths).toContain('/var/log');
	});

	it('parses a path with "cannot create" prefix', () => {
		const paths = parsePermissionDeniedPaths(
			'cannot create /tmp/build/output.o: Permission denied'
		);
		expect(paths).toContain('/tmp/build');
	});

	it('parses a path with "failed to create temporary file" prefix', () => {
		const paths = parsePermissionDeniedPaths(
			"failed to create temporary file '/run/cache/tmp123': Permission denied"
		);
		expect(paths).toContain('/run/cache');
	});

	it('normalises captured value to parent directory, not the file itself', () => {
		const paths = parsePermissionDeniedPaths("'/usr/local/bin/tool': Permission denied");
		expect(paths).toContain('/usr/local/bin');
		expect(paths).not.toContain('/usr/local/bin/tool');
	});

	it('deduplicates paths sharing the same parent directory', () => {
		const output = [
			"open '/var/log/app.log': Permission denied",
			"open '/var/log/other.log': Permission denied"
		].join('\n');
		const paths = parsePermissionDeniedPaths(output);
		expect(paths).toHaveLength(1);
		expect(paths[0]).toBe('/var/log');
	});

	it('ignores non-absolute (relative) paths', () => {
		const paths = parsePermissionDeniedPaths('relative/path/file.txt: Permission denied');
		expect(paths).toHaveLength(0);
	});

	it('parses multiple distinct permission denied lines into separate parent dirs', () => {
		const output = [
			"'/etc/shadow': Permission denied",
			"'/home/user/.ssh/id_rsa': Permission denied"
		].join('\n');
		const paths = parsePermissionDeniedPaths(output);
		expect(paths).toContain('/etc');
		expect(paths).toContain('/home/user/.ssh');
	});

	it('is case-insensitive for the "Permission denied" sentinel', () => {
		const paths = parsePermissionDeniedPaths("'/var/secret': permission denied");
		expect(paths).toContain('/var');
	});

	it('handles a path whose parent is the filesystem root', () => {
		const paths = parsePermissionDeniedPaths("'/etc': Permission denied");
		expect(paths).toContain('/');
	});

	it('handles a deeply nested path correctly', () => {
		const paths = parsePermissionDeniedPaths(
			"'/a/b/c/d/e/f/g.txt': Permission denied"
		);
		expect(paths).toContain('/a/b/c/d/e/f');
	});
});

// ---------------------------------------------------------------------------
// sandbox-rules: writable paths
// ---------------------------------------------------------------------------

describe('getWritablePaths / addWritablePath / removeWritablePath', () => {
	beforeEach(() => {
		testDb.run('DELETE FROM sandbox_writable_paths');
	});

	it('returns empty array when no paths have been added', () => {
		expect(getWritablePaths()).toHaveLength(0);
	});

	it('returns a path after it has been added', () => {
		addWritablePath('/tmp/my-build');
		expect(getWritablePaths()).toContain('/tmp/my-build');
	});

	it('adding the same path twice does not create a duplicate (INSERT OR IGNORE)', () => {
		addWritablePath('/tmp/dedup');
		addWritablePath('/tmp/dedup');
		expect(getWritablePaths().filter((p) => p === '/tmp/dedup')).toHaveLength(1);
	});

	it('removes a path by its database id', () => {
		addWritablePath('/tmp/removeme');
		const row = testDb
			.prepare("SELECT id FROM sandbox_writable_paths WHERE path = '/tmp/removeme'")
			.get() as { id: number };
		removeWritablePath(row.id);
		expect(getWritablePaths()).not.toContain('/tmp/removeme');
	});

	it('removing a non-existent id is a no-op and does not throw', () => {
		addWritablePath('/tmp/safe');
		removeWritablePath(99999);
		expect(getWritablePaths()).toContain('/tmp/safe');
	});

	it('returns all added paths', () => {
		addWritablePath('/alpha');
		addWritablePath('/beta');
		addWritablePath('/gamma');
		const paths = getWritablePaths();
		expect(paths).toContain('/alpha');
		expect(paths).toContain('/beta');
		expect(paths).toContain('/gamma');
		expect(paths).toHaveLength(3);
	});

	it('removing one path leaves the others intact', () => {
		addWritablePath('/keep-a');
		addWritablePath('/remove-me');
		addWritablePath('/keep-b');
		const row = testDb
			.prepare("SELECT id FROM sandbox_writable_paths WHERE path = '/remove-me'")
			.get() as { id: number };
		removeWritablePath(row.id);
		const paths = getWritablePaths();
		expect(paths).toContain('/keep-a');
		expect(paths).toContain('/keep-b');
		expect(paths).not.toContain('/remove-me');
	});
});

// ---------------------------------------------------------------------------
// sandbox-rules: approved commands
// ---------------------------------------------------------------------------

describe('getApprovedCommands / addApprovedCommand / removeApprovedCommand / isCommandApproved', () => {
	beforeEach(() => {
		testDb.run('DELETE FROM approved_commands');
	});

	it('returns empty array when no commands have been approved', () => {
		expect(getApprovedCommands()).toHaveLength(0);
	});

	it('returns a pattern after it has been added', () => {
		addApprovedCommand('bun test');
		expect(getApprovedCommands()).toContain('bun test');
	});

	it('adding the same pattern twice does not create a duplicate', () => {
		addApprovedCommand('bun build');
		addApprovedCommand('bun build');
		expect(getApprovedCommands().filter((c) => c === 'bun build')).toHaveLength(1);
	});

	it('removes a command by its database id', () => {
		addApprovedCommand('npm install');
		const row = testDb
			.prepare("SELECT id FROM approved_commands WHERE pattern = 'npm install'")
			.get() as { id: number };
		removeApprovedCommand(row.id);
		expect(getApprovedCommands()).not.toContain('npm install');
	});

	it('removing a non-existent id is a no-op', () => {
		addApprovedCommand('cargo build');
		removeApprovedCommand(99999);
		expect(getApprovedCommands()).toContain('cargo build');
	});

	it('isCommandApproved returns false when nothing is approved', () => {
		expect(isCommandApproved('rm -rf /')).toBe(false);
	});

	it('isCommandApproved returns true for an exact match', () => {
		addApprovedCommand('bun test');
		expect(isCommandApproved('bun test')).toBe(true);
	});

	it('isCommandApproved prefix-matches a command that starts with pattern followed by a space', () => {
		addApprovedCommand('bun test');
		expect(isCommandApproved('bun test --watch')).toBe(true);
	});

	it('isCommandApproved requires exact match, not a suffix', () => {
		addApprovedCommand('bun test');
		expect(isCommandApproved('bun')).toBe(false);
	});

	it('isCommandApproved is case-sensitive', () => {
		addApprovedCommand('Bun Test');
		expect(isCommandApproved('bun test')).toBe(false);
		expect(isCommandApproved('Bun Test')).toBe(true);
	});

	it('isCommandApproved returns false after the matching pattern is removed', () => {
		addApprovedCommand('cargo check');
		const row = testDb
			.prepare("SELECT id FROM approved_commands WHERE pattern = 'cargo check'")
			.get() as { id: number };
		expect(isCommandApproved('cargo check')).toBe(true);
		removeApprovedCommand(row.id);
		expect(isCommandApproved('cargo check')).toBe(false);
	});

	it('isCommandApproved returns false for empty string when nothing approved', () => {
		expect(isCommandApproved('')).toBe(false);
	});

	it('isCommandApproved returns true for empty string if it was explicitly approved', () => {
		addApprovedCommand('');
		expect(isCommandApproved('')).toBe(true);
	});

	it('removing one command leaves the others intact', () => {
		addApprovedCommand('keep-a');
		addApprovedCommand('remove-me');
		addApprovedCommand('keep-b');
		const row = testDb
			.prepare("SELECT id FROM approved_commands WHERE pattern = 'remove-me'")
			.get() as { id: number };
		removeApprovedCommand(row.id);
		const cmds = getApprovedCommands();
		expect(cmds).toContain('keep-a');
		expect(cmds).toContain('keep-b');
		expect(cmds).not.toContain('remove-me');
	});

	it('multiple distinct commands can all be approved simultaneously', () => {
		addApprovedCommand('bun test');
		addApprovedCommand('bun build');
		addApprovedCommand('cargo check');
		expect(isCommandApproved('bun test')).toBe(true);
		expect(isCommandApproved('bun build')).toBe(true);
		expect(isCommandApproved('cargo check')).toBe(true);
	});

	it("'bun test' prefix-matches 'bun test src/foo.spec.ts'", () => {
		addApprovedCommand('bun test');
		expect(isCommandApproved('bun test src/foo.spec.ts')).toBe(true);
	});

	it("'bun test' does NOT prefix-match 'bun testing' (no space boundary)", () => {
		addApprovedCommand('bun test');
		expect(isCommandApproved('bun testing')).toBe(false);
	});

	it("'cargo *' glob-matches 'cargo build'", () => {
		addApprovedCommand('cargo *');
		expect(isCommandApproved('cargo build')).toBe(true);
	});

	it("'cargo *' glob-matches 'cargo test --release'", () => {
		addApprovedCommand('cargo *');
		expect(isCommandApproved('cargo test --release')).toBe(true);
	});

	it("'npm run *' glob-matches 'npm run build'", () => {
		addApprovedCommand('npm run *');
		expect(isCommandApproved('npm run build')).toBe(true);
	});

	it("'npm run *' does NOT match 'npm install'", () => {
		addApprovedCommand('npm run *');
		expect(isCommandApproved('npm install')).toBe(false);
	});

	it('empty pattern only matches empty command', () => {
		addApprovedCommand('');
		expect(isCommandApproved('')).toBe(true);
		expect(isCommandApproved('anything')).toBe(false);
	});

	it("pattern with special regex chars like 'g++ *.cpp' works correctly", () => {
		addApprovedCommand('g++ *.cpp');
		expect(isCommandApproved('g++ main.cpp')).toBe(true);
		expect(isCommandApproved('g++ src/main.cpp')).toBe(true);
		expect(isCommandApproved('gcc main.cpp')).toBe(false);
	});
});
