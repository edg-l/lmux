import { mkdirSync, rmSync } from 'node:fs';
import { buildSandboxedCommand } from '../sandbox';
import { collectImages } from './collect-images';

const MAX_CODE_LENGTH = 50_000;
const MAX_OUTPUT_LENGTH = 8192;
const TIMEOUT_MS = 60_000;

export async function solveMath(args: {
	code: string;
}): Promise<{ output: string; images: Array<{ name: string; dataUrl: string }> }> {
	if (!args.code || !args.code.trim()) {
		return { output: 'Error: no code provided', images: [] };
	}
	if (args.code.length > MAX_CODE_LENGTH) {
		return {
			output: `Error: code too long (max ${MAX_CODE_LENGTH.toLocaleString()} characters)`,
			images: []
		};
	}

	const tempDir = `/tmp/lmux-math-${crypto.randomUUID()}`;

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	let killed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
	let images: Array<{ name: string; dataUrl: string }> = [];

	try {
		mkdirSync(tempDir, { recursive: true });

		await Bun.write(`${tempDir}/script.py`, args.code);

		const command = `uv run --with sympy,matplotlib python3 ${tempDir}/script.py`;
		const { args: cmdArgs } = buildSandboxedCommand(tempDir, command);

		const proc = Bun.spawn(cmdArgs, {
			cwd: tempDir,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, MPLCONFIGDIR: tempDir, MPLBACKEND: 'Agg' }
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

		images = collectImages(tempDir);
	} finally {
		if (timer) clearTimeout(timer);
		if (sigkillTimer) clearTimeout(sigkillTimer);
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}

	if (killed) {
		return { output: `Error: execution timed out after ${TIMEOUT_MS / 1000}s`, images };
	}

	const combined = (stdout + (stderr ? '\n' + stderr : '')).slice(0, MAX_OUTPUT_LENGTH);

	if (exitCode !== 0) {
		const errText = stderr.slice(0, MAX_OUTPUT_LENGTH) || combined;
		return { output: `Error (exit code ${exitCode}):\n${errText}`, images };
	}

	let output = stdout.trim() || 'No output';
	if (images.length > 0) {
		const names = images.map((i) => i.name).join(', ');
		output += `\n[${images.length} image(s) generated and displayed to user: ${names}]`;
	}

	return { output, images };
}
