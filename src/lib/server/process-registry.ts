import { buildSandboxedCommand } from './sandbox';
import { getWritablePaths } from './sandbox-rules';

interface TrackedProcess {
	id: string;
	command: string;
	proc: import('bun').Subprocess;
	output: string[];
	startedAt: Date;
	projectId: number;
	running: boolean;
	exitCode: number | null;
	timer: ReturnType<typeof setTimeout>;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_PROCESSES_PER_PROJECT = 5;
const AUTO_KILL_MS = 30 * 60 * 1000; // 30 minutes
const KILL_GRACE_MS = 5000;

const processes = new Map<string, TrackedProcess>();
let nextId = 1;
let exitHandlerRegistered = false;

function generateId(): string {
	return `bg_${nextId++}`;
}

function registerExitHandler() {
	if (exitHandlerRegistered) return;
	exitHandlerRegistered = true;
	process.on('exit', () => {
		killAllProcesses();
	});
}

function trimOutput(output: string[]): void {
	let totalSize = 0;
	for (const line of output) {
		totalSize += line.length + 1; // +1 for newline
	}
	while (totalSize > MAX_OUTPUT_BYTES && output.length > 0) {
		const removed = output.shift()!;
		totalSize -= removed.length + 1;
	}
}

async function readStream(
	stream: ReadableStream<Uint8Array> | null,
	output: string[],
	tracked: TrackedProcess
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let partial = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			partial += decoder.decode(value, { stream: true });
			const lines = partial.split('\n');
			partial = lines.pop()!;
			for (const line of lines) {
				output.push(line);
				trimOutput(output);
			}
		}
		if (partial) {
			output.push(partial);
			trimOutput(output);
		}
	} catch {
		// Stream closed
	}
}

export async function startTrackedProcess(
	command: string,
	projectId: number,
	projectRoot: string,
	waitFor?: string,
	timeoutMinutes?: number
): Promise<{ id: string; output: string; running: boolean; exitCode: number | null }> {
	// Check max processes per project
	const projectProcesses = [...processes.values()].filter(
		(p) => p.projectId === projectId && p.running
	);
	if (projectProcesses.length >= MAX_PROCESSES_PER_PROJECT) {
		throw new Error(
			`Maximum ${MAX_PROCESSES_PER_PROJECT} background processes. Stop a process first.\nRunning: ${projectProcesses.map((p) => `${p.id}: ${p.command}`).join('\n')}`
		);
	}

	registerExitHandler();

	const extraWritablePaths = getWritablePaths();
	const { args: cmdArgs } = buildSandboxedCommand(projectRoot, command, extraWritablePaths);

	const proc = Bun.spawn(cmdArgs, {
		cwd: projectRoot,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const id = generateId();
	const output: string[] = [];

	const autoKillMs = timeoutMinutes
		? Math.min(timeoutMinutes * 60 * 1000, AUTO_KILL_MS)
		: AUTO_KILL_MS;
	const timer = setTimeout(() => {
		const tracked = processes.get(id);
		if (tracked && tracked.running) {
			try {
				tracked.proc.kill('SIGTERM');
			} catch {
				// already dead
			}
			setTimeout(() => {
				try {
					tracked.proc.kill('SIGKILL');
				} catch {
					// already dead
				}
			}, KILL_GRACE_MS);
		}
	}, autoKillMs);

	const tracked: TrackedProcess = {
		id,
		command,
		proc,
		output,
		startedAt: new Date(),
		projectId,
		running: true,
		exitCode: null,
		timer
	};

	processes.set(id, tracked);

	// Start reading output in background
	readStream(proc.stdout as ReadableStream<Uint8Array>, output, tracked);
	readStream(proc.stderr as ReadableStream<Uint8Array>, output, tracked);

	// Monitor process exit
	proc.exited.then((code) => {
		tracked.running = false;
		tracked.exitCode = code;
		clearTimeout(tracked.timer);
	});

	// Wait logic
	if (waitFor) {
		// Wait up to 10 seconds for the string to appear
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			if (output.some((line) => line.includes(waitFor))) {
				return {
					id,
					output: output.join('\n'),
					running: tracked.running,
					exitCode: tracked.exitCode
				};
			}
			// Check if process already exited
			if (!tracked.running) {
				return {
					id,
					output: output.join('\n'),
					running: false,
					exitCode: tracked.exitCode
				};
			}
			await Bun.sleep(200);
		}
	} else {
		// Wait 2 seconds for initial output
		const deadline = Date.now() + 2000;
		while (Date.now() < deadline) {
			if (!tracked.running) {
				return {
					id,
					output: output.join('\n'),
					running: false,
					exitCode: tracked.exitCode
				};
			}
			await Bun.sleep(200);
		}
	}

	return {
		id,
		output: output.join('\n'),
		running: tracked.running,
		exitCode: tracked.exitCode
	};
}

export async function stopTrackedProcess(
	id: string
): Promise<{ output: string; exitCode: number | null }> {
	const tracked = processes.get(id);
	if (!tracked) {
		throw new Error(`No process found with id "${id}"`);
	}

	clearTimeout(tracked.timer);

	if (!tracked.running) {
		const output = tracked.output.join('\n');
		processes.delete(id);
		return { output, exitCode: tracked.exitCode };
	}

	// Send SIGTERM
	try {
		tracked.proc.kill('SIGTERM');
	} catch {
		// already dead
	}

	// Wait up to 5 seconds for exit
	const deadline = Date.now() + KILL_GRACE_MS;
	while (Date.now() < deadline && tracked.running) {
		await Bun.sleep(200);
	}

	// Force kill if still running
	if (tracked.running) {
		try {
			tracked.proc.kill('SIGKILL');
		} catch {
			// already dead
		}
		// Wait a bit more for exit
		await Bun.sleep(500);
	}

	const output = tracked.output.join('\n');
	const exitCode = tracked.exitCode;
	processes.delete(id);
	return { output, exitCode };
}

export function getRunningProcesses(
	projectId: number
): Array<{ id: string; command: string; startedAt: string; running: boolean }> {
	return [...processes.values()]
		.filter((p) => p.projectId === projectId)
		.map((p) => ({
			id: p.id,
			command: p.command,
			startedAt: p.startedAt.toISOString(),
			running: p.running
		}));
}

export function killAllProcesses(projectId?: number): void {
	for (const [id, tracked] of processes) {
		if (projectId !== undefined && tracked.projectId !== projectId) continue;
		clearTimeout(tracked.timer);
		if (tracked.running) {
			try {
				tracked.proc.kill('SIGTERM');
			} catch {
				// already dead
			}
			setTimeout(() => {
				try {
					tracked.proc.kill('SIGKILL');
				} catch {
					// already dead
				}
			}, KILL_GRACE_MS);
		}
		processes.delete(id);
	}
}
