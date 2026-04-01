import { buildSandboxedCommand, parsePermissionDeniedPaths } from '../sandbox';
import { getWritablePaths } from '../sandbox-rules';

const MAX_TIMEOUT = 300_000;
const DEFAULT_MAX_LENGTH = 8192;

export async function runProjectCommand(
	args: { command: string; timeout?: number; offset?: number; max_length?: number },
	projectRoot: string
): Promise<{ output: string; blockedPaths: string[] }> {
	const timeoutMs = Math.min(Math.max((args.timeout ?? 30) * 1000, 1000), MAX_TIMEOUT);
	const maxLength = args.max_length ?? DEFAULT_MAX_LENGTH;
	const offset = args.offset ?? 0;

	const extraWritablePaths = getWritablePaths();
	const { args: cmdArgs } = buildSandboxedCommand(projectRoot, args.command, extraWritablePaths);

	const proc = Bun.spawn(cmdArgs, {
		cwd: projectRoot,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	let killed = false;
	const timer = setTimeout(() => {
		killed = true;
		proc.kill('SIGTERM');
		setTimeout(() => {
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

	let output = stdout + (stderr ? '\n' + stderr : '');

	if (killed) {
		output += `\n[command timed out after ${timeoutMs / 1000}s]`;
	}

	const totalBytes = output.length;
	const sliced = output.slice(offset, offset + maxLength);

	let finalOutput = sliced;
	if (sliced.length < totalBytes - offset) {
		finalOutput =
			sliced + `\n[truncated, ${totalBytes} bytes total. Use offset/max_length to read more]`;
	}

	const blockedPaths = exitCode !== 0 ? parsePermissionDeniedPaths(output) : [];

	return { output: finalOutput, blockedPaths };
}
