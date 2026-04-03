import { buildSandboxedCommand } from '../sandbox';

const MAX_CODE_LENGTH = 50_000;
const MAX_OUTPUT_LENGTH = 8192;
const TIMEOUT_MS = 60_000;

export async function solveMath(args: { code: string }): Promise<string> {
	if (!args.code || !args.code.trim()) {
		return 'Error: no code provided';
	}
	if (args.code.length > MAX_CODE_LENGTH) {
		return `Error: code too long (max ${MAX_CODE_LENGTH.toLocaleString()} characters)`;
	}

	const tmpFile = `/tmp/lmux-math-${crypto.randomUUID()}.py`;

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	let killed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

	try {
		await Bun.write(tmpFile, args.code);

		const command = `uv run --with sympy python3 ${tmpFile}`;
		const { args: cmdArgs } = buildSandboxedCommand('/tmp', command);

		const proc = Bun.spawn(cmdArgs, {
			cwd: '/tmp',
			stdout: 'pipe',
			stderr: 'pipe'
		});

		timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGTERM');
			sigkillTimer = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process may already be dead
				}
			}, 5000);
		}, TIMEOUT_MS);

		[stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		exitCode = await proc.exited;
	} finally {
		if (timer) clearTimeout(timer);
		if (sigkillTimer) clearTimeout(sigkillTimer);
		try {
			const { unlink } = await import('node:fs/promises');
			await unlink(tmpFile);
		} catch {
			// Ignore cleanup errors
		}
	}

	if (killed) {
		return `Error: execution timed out after ${TIMEOUT_MS / 1000}s`;
	}

	const combined = (stdout + (stderr ? '\n' + stderr : '')).slice(0, MAX_OUTPUT_LENGTH);

	if (exitCode !== 0) {
		const errText = stderr.slice(0, MAX_OUTPUT_LENGTH) || combined;
		return `Error (exit code ${exitCode}):\n${errText}`;
	}

	return stdout.trim() || 'No output';
}
