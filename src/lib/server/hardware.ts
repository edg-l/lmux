import { readFileSync, statfsSync } from 'node:fs';
import { getDb } from './db';
import { getModelsDir, getSetting } from './settings';

export interface GpuInfo {
	name: string;
	vendor: 'nvidia' | 'amd';
	vram_total: number;
	vram_free: number;
	driver_version: string;
}

export interface MemoryInfo {
	total: number;
	available: number;
}

export interface CpuInfo {
	model: string;
	physical_cores: number;
	threads: number;
}

export interface DiskInfo {
	path: string;
	total: number;
	available: number;
}

export interface HardwareProfile {
	gpus: GpuInfo[];
	memory: MemoryInfo;
	cpu: CpuInfo;
	disk: DiskInfo;
	detected_at: string;
}

function detectNvidiaGpus(): GpuInfo[] {
	try {
		const proc = Bun.spawnSync({
			cmd: [
				'nvidia-smi',
				'--query-gpu=name,memory.total,memory.free,driver_version',
				'--format=csv,noheader,nounits'
			],
			stdout: 'pipe',
			stderr: 'pipe'
		});

		if (proc.exitCode !== 0) return [];

		const output = proc.stdout.toString().trim();
		if (!output) return [];

		return output.split('\n').map((line: string) => {
			const [name, totalMb, freeMb, driver] = line.split(',').map((s: string) => s.trim());
			return {
				name,
				vendor: 'nvidia' as const,
				vram_total: parseInt(totalMb) * 1024 * 1024,
				vram_free: parseInt(freeMb) * 1024 * 1024,
				driver_version: driver
			};
		});
	} catch {
		return [];
	}
}

function detectAmdGpus(): GpuInfo[] {
	try {
		// Try rocm-smi for GPU name
		const nameProc = Bun.spawnSync({
			cmd: ['rocm-smi', '--showproductname', '--csv'],
			stdout: 'pipe',
			stderr: 'pipe'
		});

		if (nameProc.exitCode !== 0) return [];

		const nameOutput = nameProc.stdout.toString().trim();
		const nameLines = nameOutput
			.split('\n')
			.filter((l: string) => l.trim() && !l.startsWith('device'));
		if (nameLines.length === 0) return [];

		// Get VRAM info
		const memProc = Bun.spawnSync({
			cmd: ['rocm-smi', '--showmeminfo', 'vram', '--csv'],
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const gpus: GpuInfo[] = [];

		if (memProc.exitCode === 0) {
			const memOutput = memProc.stdout.toString().trim();
			const memLines = memOutput
				.split('\n')
				.filter((l: string) => l.trim() && !l.startsWith('device') && !l.startsWith('GPU'));

			for (let i = 0; i < nameLines.length; i++) {
				const nameParts = nameLines[i].split(',');
				const gpuName =
					nameParts.length > 1 ? nameParts.slice(1).join(',').trim() : nameParts[0].trim();

				let vramTotal = 0;
				let vramFree = 0;

				if (i < memLines.length) {
					const memParts = memLines[i].split(',').map((s: string) => s.trim());
					// rocm-smi CSV: device, vram_total, vram_used
					if (memParts.length >= 3) {
						vramTotal = parseInt(memParts[1]) || 0;
						const vramUsed = parseInt(memParts[2]) || 0;
						vramFree = vramTotal - vramUsed;
					}
				}

				gpus.push({
					name: gpuName,
					vendor: 'amd',
					vram_total: vramTotal,
					vram_free: vramFree,
					driver_version: ''
				});
			}
		} else {
			for (const line of nameLines) {
				const parts = line.split(',');
				const gpuName = parts.length > 1 ? parts.slice(1).join(',').trim() : parts[0].trim();
				gpus.push({
					name: gpuName,
					vendor: 'amd',
					vram_total: 0,
					vram_free: 0,
					driver_version: ''
				});
			}
		}

		return gpus;
	} catch {
		return [];
	}
}

function detectMemory(): MemoryInfo {
	try {
		const content = readFileSync('/proc/meminfo', 'utf-8');
		const lines = content.split('\n');

		let total = 0;
		let available = 0;

		for (const line of lines) {
			if (line.startsWith('MemTotal:')) {
				total = parseInt(line.split(/\s+/)[1]) * 1024; // kB to bytes
			} else if (line.startsWith('MemAvailable:')) {
				available = parseInt(line.split(/\s+/)[1]) * 1024;
			}
		}

		return { total, available };
	} catch {
		return { total: 0, available: 0 };
	}
}

function detectCpu(): CpuInfo {
	try {
		const content = readFileSync('/proc/cpuinfo', 'utf-8');
		const lines = content.split('\n');

		let model = '';
		let currentPhysicalId = '0';
		const uniqueCores = new Set<string>();
		let threads = 0;

		for (const line of lines) {
			if (line.startsWith('model name') && !model) {
				model = line.split(':')[1]?.trim() ?? '';
			} else if (line.startsWith('physical id')) {
				currentPhysicalId = line.split(':')[1]?.trim() ?? '0';
			} else if (line.startsWith('core id')) {
				const coreId = line.split(':')[1]?.trim() ?? '0';
				uniqueCores.add(`${currentPhysicalId}:${coreId}`);
			} else if (line.startsWith('processor')) {
				threads++;
			}
		}

		// Physical cores: count unique (physical_id, core_id) pairs
		const physicalCores = uniqueCores.size > 0 ? uniqueCores.size : threads;

		return { model, physical_cores: physicalCores, threads };
	} catch {
		return { model: 'Unknown', physical_cores: 0, threads: 0 };
	}
}

function detectDisk(): DiskInfo {
	const modelsDir = getModelsDir();
	try {
		const stats = statfsSync(modelsDir);
		return {
			path: modelsDir,
			total: stats.blocks * stats.bsize,
			available: stats.bavail * stats.bsize
		};
	} catch {
		return { path: modelsDir, total: 0, available: 0 };
	}
}

function detectHardware(): HardwareProfile {
	const nvidiaGpus = detectNvidiaGpus();
	const amdGpus = detectAmdGpus();

	return {
		gpus: [...nvidiaGpus, ...amdGpus],
		memory: detectMemory(),
		cpu: detectCpu(),
		disk: detectDisk(),
		detected_at: new Date().toISOString()
	};
}

export function getUsableVram(hardware: HardwareProfile): number {
	const totalVram = hardware.gpus.reduce((sum, gpu) => sum + gpu.vram_total, 0);
	const headroomMb = parseInt(getSetting('vram_headroom_mb')) || 512;
	return Math.max(0, totalVram - headroomMb * 1024 * 1024);
}

export function getHardwareProfile(): HardwareProfile {
	const db = getDb();
	const cached = db
		.prepare('SELECT data, detected_at FROM hardware_cache ORDER BY id DESC LIMIT 1')
		.get() as { data: string; detected_at: string } | undefined;

	if (cached) {
		return JSON.parse(cached.data) as HardwareProfile;
	}

	return refreshHardwareProfile();
}

export function refreshHardwareProfile(): HardwareProfile {
	const profile = detectHardware();
	const db = getDb();

	// Clear old cache entries
	db.run('DELETE FROM hardware_cache');

	// Insert fresh detection
	db.prepare('INSERT INTO hardware_cache (data, detected_at) VALUES ($data, $detected_at)').run({
		$data: JSON.stringify(profile),
		$detected_at: profile.detected_at
	});

	return profile;
}
