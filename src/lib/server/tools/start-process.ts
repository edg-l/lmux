import { startTrackedProcess, getRunningProcesses } from '../process-registry';

export async function startBackgroundProcess(
	args: { command: string; wait_for?: string },
	projectRoot: string,
	projectId: number
): Promise<{ result: string; error?: boolean }> {
	try {
		const { id, output, running, exitCode } = await startTrackedProcess(
			args.command,
			projectId,
			projectRoot,
			args.wait_for
		);

		const status = running ? 'running' : `exited (code ${exitCode})`;
		let result = `Started background process ${id}: ${args.command}\nStatus: ${status}`;
		if (output) {
			result += `\nOutput:\n${output}`;
		}
		return { result };
	} catch (e) {
		if (e instanceof Error && e.message.startsWith('Maximum')) {
			return { result: `Error: ${e.message}`, error: true };
		}
		return {
			result: `Error starting process: ${e instanceof Error ? e.message : 'unknown error'}`,
			error: true
		};
	}
}
