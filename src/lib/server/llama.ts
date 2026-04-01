import type { Subprocess } from 'bun';
import { mkdirSync } from 'node:fs';
import { Mutex } from './mutex';

export interface ServerState {
	status: 'stopped' | 'starting' | 'ready' | 'error';
	modelId: number | null;
	modelName: string | null;
	port: number;
	contextSize: number | null;
	pid: number | null;
	startedAt: Date | null;
	error: string | null;
	stderr: string[];
	lastTokensPerSecond: number | null;
}

export interface StartConfig {
	modelPath: string;
	modelId: number;
	modelName: string;
	gpuLayers: number;
	contextSize: number;
	port: number;
	threads?: number | null;
	batchSize?: number | null;
	flashAttn?: string | null;
	kvCacheType?: string | null;
	extraFlags?: string;
	mmprojPath?: string;
	slotSavePath?: string;
	llamaServerPath: string;
}

const MAX_STDERR_LINES = 100;

let serverState: ServerState = {
	status: 'stopped',
	modelId: null,
	modelName: null,
	port: 8080,
	contextSize: null,
	pid: null,
	startedAt: null,
	error: null,
	stderr: [],
	lastTokensPerSecond: null
};

let childProcess: Subprocess | null = null;
let healthInterval: ReturnType<typeof setInterval> | null = null;
const serverMutex = new Mutex();

// Kill llama-server if our process exits, so it doesn't orphan and eat VRAM
function cleanupOnExit() {
	if (childProcess) {
		childProcess.kill('SIGKILL');
		childProcess = null;
	}
}
process.on('SIGINT', () => {
	cleanupOnExit();
	process.exit(0);
});
process.on('SIGTERM', () => {
	cleanupOnExit();
	process.exit(0);
});
process.on('exit', cleanupOnExit);

/**
 * Auto-detect llama-server binary from PATH.
 */
export async function detectLlamaServer(): Promise<string | null> {
	for (const name of ['llama-server', 'llama.cpp-server', 'server']) {
		const proc = Bun.spawnSync({
			cmd: ['which', name],
			stdout: 'pipe',
			stderr: 'pipe'
		});

		if (proc.exitCode === 0) {
			const path = proc.stdout.toString().trim();
			if (path) return path;
		}
	}

	return null;
}

export function getServerState(): ServerState {
	return { ...serverState };
}

export async function startServer(config: StartConfig): Promise<void> {
	const release = await serverMutex.lock();
	try {
		// One-server-at-a-time enforcement
		if (serverState.status === 'starting' || serverState.status === 'ready') {
			throw new Error('A server is already running. Stop it before starting a new one.');
		}

		const args = [
			'-m',
			config.modelPath,
			'-ngl',
			String(config.gpuLayers),
			'-c',
			String(config.contextSize),
			'--port',
			String(config.port)
		];

		if (config.threads && config.threads > 0) {
			args.push('--threads', String(config.threads));
		}
		if (config.batchSize && config.batchSize > 0) {
			args.push('-b', String(config.batchSize));
		}
		if (config.flashAttn) {
			args.push('--flash-attn', config.flashAttn);
		}
		if (config.kvCacheType) {
			args.push('-ctk', config.kvCacheType, '-ctv', config.kvCacheType);
		}

		if (config.mmprojPath) {
			args.push('--mmproj', config.mmprojPath);
		}

		if (config.extraFlags) {
			const extra = config.extraFlags.trim().split(/\s+/);
			args.push(...extra);
		}

		if (config.slotSavePath && config.slotSavePath.trim()) {
			mkdirSync(config.slotSavePath, { recursive: true });
			args.push('--slot-save-path', config.slotSavePath);
		}

		serverState = {
			status: 'starting',
			modelId: config.modelId,
			modelName: config.modelName,
			port: config.port,
			contextSize: config.contextSize,
			pid: null,
			startedAt: new Date(),
			error: null,
			stderr: [],
			lastTokensPerSecond: null
		};

		try {
			childProcess = Bun.spawn({
				cmd: [config.llamaServerPath, ...args],
				stdout: 'pipe',
				stderr: 'pipe'
			});

			serverState.pid = childProcess.pid;

			// Read stderr in the background
			readStderr(childProcess);

			// Monitor process exit
			childProcess.exited.then((exitCode) => {
				if (healthInterval) {
					clearInterval(healthInterval);
					healthInterval = null;
				}

				if (serverState.status !== 'stopped') {
					serverState = {
						...serverState,
						status: exitCode === 0 ? 'stopped' : 'error',
						pid: null,
						error: exitCode !== 0 ? `Process exited with code ${exitCode}` : null
					};
				}

				childProcess = null;
			});

			// Start health polling
			startHealthPolling(config.port);
		} catch (err) {
			serverState = {
				...serverState,
				status: 'error',
				pid: null,
				error: err instanceof Error ? err.message : 'Failed to spawn llama-server'
			};
			throw err;
		}
	} finally {
		release();
	}
}

export async function stopServer(): Promise<void> {
	const release = await serverMutex.lock();
	try {
		if (!childProcess) {
			serverState = {
				...serverState,
				status: 'stopped',
				pid: null,
				error: null
			};
			return;
		}

		if (healthInterval) {
			clearInterval(healthInterval);
			healthInterval = null;
		}

		// Send SIGTERM
		childProcess.kill('SIGTERM');

		// Wait up to 5 seconds for graceful shutdown
		const exited = await Promise.race([
			childProcess.exited.then(() => true),
			new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000))
		]);

		if (!exited && childProcess) {
			childProcess.kill('SIGKILL');
			await childProcess.exited;
		}

		childProcess = null;

		serverState = {
			status: 'stopped',
			modelId: null,
			modelName: null,
			port: serverState.port,
			contextSize: null,
			pid: null,
			startedAt: null,
			error: null,
			stderr: [],
			lastTokensPerSecond: null
		};
	} finally {
		release();
	}
}

function startHealthPolling(port: number) {
	if (healthInterval) {
		clearInterval(healthInterval);
	}

	healthInterval = setInterval(async () => {
		if (serverState.status === 'stopped' || serverState.status === 'error') {
			if (healthInterval) {
				clearInterval(healthInterval);
				healthInterval = null;
			}
			return;
		}

		try {
			const res = await fetch(`http://localhost:${port}/health`, {
				signal: AbortSignal.timeout(2000)
			});

			if (res.ok && serverState.status === 'starting') {
				serverState = { ...serverState, status: 'ready' };
			}
		} catch {
			// Server not ready yet, keep polling
		}
	}, 1000);
}

async function readStderr(proc: Subprocess) {
	if (!proc.stderr || typeof proc.stderr === 'number') return;

	const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split('\n');
			// Keep the last incomplete line in the buffer
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.trim()) continue;

				const newStderr = [...serverState.stderr, line];
				if (newStderr.length > MAX_STDERR_LINES) {
					newStderr.shift();
				}

				// Parse tokens/s from llama-server output
				const tpsMatch =
					line.match(/(\d+\.?\d*)\s*tokens?\s*per\s*second/i) || line.match(/(\d+\.?\d*)\s*t\/s/i);

				serverState = {
					...serverState,
					stderr: newStderr,
					lastTokensPerSecond: tpsMatch ? parseFloat(tpsMatch[1]) : serverState.lastTokensPerSecond
				};
			}
		}
	} catch {
		// Stream closed
	}
}
