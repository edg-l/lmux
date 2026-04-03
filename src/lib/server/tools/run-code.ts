import { mkdirSync, rmSync } from 'node:fs';
import { buildSandboxedCommand } from '../sandbox';
import { collectImages } from './collect-images';

const MAX_TIMEOUT = 120_000;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_LENGTH = 8192;
const MAX_CODE_LENGTH = 100_000;

export async function runCode(args: {
	language: string;
	code: string;
	timeout?: number;
	offset?: number;
	max_length?: number;
}): Promise<{ output: string; images: Array<{ name: string; dataUrl: string }> }> {
	const lang = args.language?.toLowerCase();
	if (!['python', 'bash', 'sh'].includes(lang)) {
		return { output: 'Error: language must be one of: python, bash, sh', images: [] };
	}

	if (!args.code || !args.code.trim()) {
		return { output: 'Error: no code provided', images: [] };
	}

	if (args.code.length > MAX_CODE_LENGTH) {
		return {
			output: `Error: code too long (max ${MAX_CODE_LENGTH.toLocaleString()} characters)`,
			images: []
		};
	}

	const timeoutMs = Math.min(Math.max((args.timeout ?? 30) * 1000, 1000), MAX_TIMEOUT);
	const maxLength = Math.min(args.max_length ?? DEFAULT_MAX_LENGTH, 1_000_000);
	const offset = args.offset ?? 0;

	const uuid = crypto.randomUUID();
	const tempDir = `/tmp/lmux-code-${uuid}`;

	try {
		mkdirSync(tempDir, { recursive: true });

		const isPython = lang === 'python';
		const filename = isPython ? 'script.py' : 'script.sh';
		const filePath = `${tempDir}/${filename}`;

		await Bun.write(filePath, args.code);

		const command = isPython ? `uv run --with matplotlib python3 ${filename}` : `bash ${filename}`;
		const { args: cmdArgs } = buildSandboxedCommand(tempDir, command);

		const startTime = performance.now();
		const proc = Bun.spawn(cmdArgs, {
			cwd: tempDir,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, MPLCONFIGDIR: tempDir, MPLBACKEND: 'Agg' }
		});

		let killed = false;
		let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
		const timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGTERM');
			sigkillTimer = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process may already be dead
				}
			}, 5000);
		}, timeoutMs);

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		const exitCode = await proc.exited;
		clearTimeout(timer);
		if (sigkillTimer) clearTimeout(sigkillTimer);

		const elapsed = performance.now() - startTime;
		const elapsedStr =
			elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`;

		let output = stdout + (stderr ? '\n' + stderr : '');

		if (killed) {
			output += `\n[execution timed out after ${timeoutMs / 1000}s]`;
		}

		output += `\n[exit ${exitCode}, ${elapsedStr}]`;

		const totalBytes = output.length;
		const sliced = output.slice(offset, offset + maxLength);

		let finalOutput = sliced;
		if (sliced.length < totalBytes - offset) {
			finalOutput =
				sliced + `\n[truncated, ${totalBytes} bytes total. Use offset/max_length to read more]`;
		}

		const images = collectImages(tempDir);
		if (images.length > 0) {
			finalOutput += `\n[${images.length} image(s) generated]`;
		}

		return { output: finalOutput, images };
	} finally {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}
