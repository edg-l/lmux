import { describe, it, expect } from 'bun:test';
import { detectDangerousPatterns } from './danger-detect';

describe('detectDangerousPatterns', () => {
	// eval and exec rules
	it('detects eval someCommand', () => {
		const matches = detectDangerousPatterns('eval someCommand');
		expect(matches.some((m) => m.label === 'eval')).toBe(true);
	});

	it('detects exec /bin/sh', () => {
		const matches = detectDangerousPatterns('exec /bin/sh');
		expect(matches.some((m) => m.label === 'exec')).toBe(true);
	});

	// Output redirect detection
	it('detects output redirect > /etc/passwd', () => {
		const matches = detectDangerousPatterns('echo foo > /etc/passwd');
		expect(matches.some((m) => m.label === 'output redirect (>)')).toBe(true);
	});

	it('detects output redirect >> /tmp/log', () => {
		const matches = detectDangerousPatterns('echo foo >> /tmp/log');
		expect(matches.some((m) => m.label === 'output redirect (>)')).toBe(true);
	});

	it('does NOT detect 2>&1 as dangerous redirect', () => {
		const matches = detectDangerousPatterns('some-command 2>&1');
		expect(matches.some((m) => m.label === 'output redirect (>)')).toBe(false);
	});

	it('does NOT detect >&2 as dangerous redirect', () => {
		const matches = detectDangerousPatterns('cmd >&2');
		expect(matches.some((m) => m.label === 'output redirect (>)')).toBe(false);
	});

	// Backtick substitution
	it('detects backtick substitution', () => {
		const matches = detectDangerousPatterns('echo `whoami`');
		expect(matches.some((m) => m.label === 'backtick substitution')).toBe(true);
	});

	// Subshell $()
	it('detects subshell $()', () => {
		const matches = detectDangerousPatterns('echo $(whoami)');
		expect(matches.some((m) => m.label === 'subshell $(...)')).toBe(true);
	});

	// Safe commands
	it('returns empty array for ls -la', () => {
		const matches = detectDangerousPatterns('ls -la');
		expect(matches).toHaveLength(0);
	});

	it('returns empty array for bun test', () => {
		const matches = detectDangerousPatterns('bun test');
		expect(matches).toHaveLength(0);
	});

	// Existing rules still work
	it('detects rm -rf dist', () => {
		const matches = detectDangerousPatterns('rm -rf dist');
		expect(matches.some((m) => m.label === 'rm -rf')).toBe(true);
	});

	it('detects git reset --hard', () => {
		const matches = detectDangerousPatterns('git reset --hard');
		expect(matches.some((m) => m.label === 'git reset --hard')).toBe(true);
	});

	// Multiple dangers in one command
	it('detects both eval and subshell in eval $(cat /etc/passwd)', () => {
		const matches = detectDangerousPatterns('eval $(cat /etc/passwd)');
		expect(matches.some((m) => m.label === 'eval')).toBe(true);
		expect(matches.some((m) => m.label === 'subshell $(...)')).toBe(true);
	});
});
