import { statSync } from 'node:fs';
import { dirname } from 'node:path';

let landLockAvailable: boolean | null = null;
let bashPath: string = '/bin/bash';

export function isLandlockAvailable(): boolean {
	if (landLockAvailable === null) {
		landLockAvailable = !!Bun.which('landlock-restrict');
		bashPath = Bun.which('bash') ?? '/bin/bash';
	}
	return landLockAvailable;
}

export function buildSandboxedCommand(
	projectPath: string,
	command: string,
	extraWritablePaths: string[] = []
): { args: string[]; sandboxed: boolean } {
	if (isLandlockAvailable()) {
		const args = [
			'landlock-restrict',
			'-ro',
			'/',
			'-rw',
			projectPath,
			'-rw',
			'/tmp',
			'-rwfiles',
			'/dev/null'
		];

		for (const p of extraWritablePaths) {
			try {
				const st = statSync(p);
				if (st.isDirectory()) {
					args.push('-rw', p);
				} else {
					args.push('-rwfiles', p);
				}
			} catch {
				// Path doesn't exist yet, skip
			}
		}

		args.push('--', bashPath, '-c', command);

		return { args, sandboxed: true };
	}
	return {
		args: ['bash', '-c', command],
		sandboxed: false
	};
}

export function parsePermissionDeniedPaths(output: string): string[] {
	const paths = new Set<string>();
	// Match patterns like:
	// '<path>': Permission denied
	// cannot create <path>: Permission denied
	// failed to create temporary file '<path>': Permission denied
	// General: capture path before `: Permission denied`
	const regex = /['']?([^''\n:]+?)['']?\s*:\s*Permission denied/gi;
	let match;
	while ((match = regex.exec(output)) !== null) {
		let raw = match[1].trim();
		// Strip leading text like "cannot create " or "failed to create temporary file "
		const prefixPattern = /^(?:.*?(?:create|open|write|access|stat)\s+)/i;
		const prefixMatch = raw.match(prefixPattern);
		if (prefixMatch) {
			raw = raw.slice(prefixMatch[0].length);
		}
		// Strip surrounding quotes if any
		raw = raw.replace(/^[''"]+|[''"]+$/g, '');
		// Must look like an absolute path
		if (raw.startsWith('/')) {
			// Normalize to parent directory
			const parent = dirname(raw);
			paths.add(parent);
		}
	}
	return [...paths];
}
