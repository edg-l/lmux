import { stopTrackedProcess } from '../process-registry';

export async function stopBackgroundProcess(args: {
	id: string;
}): Promise<{ result: string; error?: boolean }> {
	try {
		const { output, exitCode } = await stopTrackedProcess(args.id);

		let result = `Stopped process ${args.id} (exit code: ${exitCode})`;
		if (output) {
			result += `\nOutput:\n${output}`;
		}
		return { result };
	} catch (e) {
		return {
			result: `Error: ${e instanceof Error ? e.message : 'unknown error'}`,
			error: true
		};
	}
}
