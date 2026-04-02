import { getRunningProcesses } from '../process-registry';

export function listBackgroundProcesses(projectId: number): { result: string } {
	const processes = getRunningProcesses(projectId);
	if (processes.length === 0) {
		return { result: 'No background processes running.' };
	}

	const lines = processes.map((p) => {
		const age = Math.floor((Date.now() - new Date(p.startedAt).getTime()) / 1000);
		const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
		const status = p.running ? 'running' : 'stopped';
		return `${p.id}: ${p.command} (${status}, ${ageStr} ago)`;
	});

	return { result: `Background processes:\n${lines.join('\n')}` };
}
