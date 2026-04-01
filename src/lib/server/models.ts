import { readdirSync, statSync, readlinkSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import { queryAll, queryOne, execute } from './db';
import { getModelInfo } from './gguf';
import { getModelsDir, getHfCacheDir } from './settings';
import { getHardwareProfile, getUsableVram } from './hardware';
import { recommendGpuLayers, recommendContextLength } from './recommendations';
import type { ModelInfo } from './gguf';

export interface ModelRow {
	id: number;
	filename: string;
	filepath: string;
	size_bytes: number | null;
	architecture: string | null;
	parameter_count: number | null;
	quant_type: string | null;
	context_length: number | null;
	block_count: number | null;
	hf_repo: string | null;
	hf_filename: string | null;
	created_at: string;
}

export interface ProfileRow {
	id: number;
	model_id: number;
	name: string;
	gpu_layers: number | null;
	context_size: number | null;
	port: number;
	threads: number | null;
	batch_size: number | null;
	flash_attn: string;
	kv_cache_type: string;
	extra_flags: string | null;
	created_at: string;
}

export interface ProfileInput {
	name: string;
	gpu_layers?: number | null;
	context_size?: number | null;
	port?: number;
	threads?: number | null;
	batch_size?: number | null;
	flash_attn?: string;
	kv_cache_type?: string;
	extra_flags?: string | null;
}

/**
 * Recursively find all .gguf files in models dir and HF cache, register new ones in DB.
 */
export async function scanModels(): Promise<number> {
	const modelsDir = getModelsDir();
	const ggufFiles = findGgufFiles(modelsDir);

	// Also scan HuggingFace cache
	const hfCacheDir = getHfCacheDir();
	if (hfCacheDir) {
		ggufFiles.push(...findHfCacheGgufs(hfCacheDir));
	}

	let added = 0;

	for (const filepath of ggufFiles) {
		// Resolve symlinks to get the real path (HF cache uses symlinks to blobs)
		let realPath: string;
		try {
			realPath = realpathSync(filepath);
		} catch {
			continue; // Broken symlink
		}

		// Check if already in DB by real path or original path
		const existing = queryOne<{ id: number }>(
			'SELECT id FROM models WHERE filepath = $filepath OR filepath = $realpath',
			{ $filepath: filepath, $realpath: realPath }
		);
		if (existing) continue;

		try {
			const info = await getModelInfo(realPath);
			const filename = basename(filepath);

			// Extract HF repo info from cache path if applicable
			const hfInfo = parseHfCachePath(filepath);

			execute(
				`INSERT INTO models (filename, filepath, size_bytes, architecture, parameter_count, quant_type, context_length, block_count, hf_repo, hf_filename)
				 VALUES ($filename, $filepath, $size_bytes, $architecture, $parameter_count, $quant_type, $context_length, $block_count, $hf_repo, $hf_filename)`,
				{
					$filename: filename,
					$filepath: filepath,
					$size_bytes: info.fileSize,
					$architecture: info.architecture,
					$parameter_count: info.parameterCount,
					$quant_type: info.quantType,
					$context_length: info.contextLength,
					$block_count: info.blockCount || null,
					$hf_repo: hfInfo?.repo ?? null,
					$hf_filename: hfInfo?.filename ?? null
				}
			);
			added++;
		} catch (e) {
			// Skip files that fail to parse
			console.error(`Failed to parse ${filepath}:`, e);
		}
	}

	return added;
}

function findGgufFiles(dir: string): string[] {
	const results: string[] = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...findGgufFiles(fullPath));
			} else if (entry.name.endsWith('.gguf') && !entry.name.includes('mmproj')) {
				results.push(fullPath);
			}
		}
	} catch {
		// Directory not readable
	}
	return results;
}

/**
 * Find GGUF files in HuggingFace cache.
 * Structure: hub/models--{owner}--{repo}/snapshots/{hash}/{filename}.gguf
 * Files are symlinks to ../../blobs/{sha256}
 */
function findHfCacheGgufs(hubDir: string): string[] {
	const results: string[] = [];
	try {
		const modelDirs = readdirSync(hubDir, { withFileTypes: true });
		for (const modelDir of modelDirs) {
			if (!modelDir.isDirectory() || !modelDir.name.startsWith('models--')) continue;

			const snapshotsDir = join(hubDir, modelDir.name, 'snapshots');
			try {
				const snapshots = readdirSync(snapshotsDir, { withFileTypes: true });
				for (const snapshot of snapshots) {
					if (!snapshot.isDirectory()) continue;
					const snapshotPath = join(snapshotsDir, snapshot.name);
					try {
						const files = readdirSync(snapshotPath, { withFileTypes: true });
						for (const file of files) {
							if (file.name.endsWith('.gguf') && !file.name.includes('mmproj')) {
								const fullPath = join(snapshotPath, file.name);
								// Verify the symlink target exists (skip .incomplete blobs)
								try {
									const target = readlinkSync(fullPath);
									if (target.endsWith('.incomplete')) continue;
									realpathSync(fullPath); // Throws if broken
									results.push(fullPath);
								} catch {
									// Not a symlink or broken, try as regular file
									try {
										statSync(fullPath);
										results.push(fullPath);
									} catch {
										// Skip
									}
								}
							}
						}
					} catch {
						// Snapshot dir not readable
					}
				}
			} catch {
				// No snapshots dir
			}
		}
	} catch {
		// Hub dir not readable
	}
	return results;
}

/**
 * Parse HF repo info from a cache path.
 * Input: .../hub/models--owner--repo/snapshots/hash/filename.gguf
 * Returns: { repo: "owner/repo", filename: "filename.gguf" }
 */
function parseHfCachePath(filepath: string): { repo: string; filename: string } | null {
	const match = filepath.match(/models--([^/]+)--([^/]+)\/snapshots\/[^/]+\/([^/]+\.gguf)$/);
	if (!match) return null;
	return { repo: `${match[1]}/${match[2]}`, filename: match[3] };
}

/**
 * Get all models from DB.
 */
export function getAllModels(): (ModelRow & { profile_count: number })[] {
	return queryAll<ModelRow & { profile_count: number }>(
		`SELECT m.*, (SELECT COUNT(*) FROM profiles p WHERE p.model_id = m.id) as profile_count
		 FROM models m ORDER BY m.created_at DESC`
	);
}

/**
 * Get a single model by ID.
 */
export function getModel(id: number): ModelRow | null {
	return queryOne<ModelRow>('SELECT * FROM models WHERE id = $id', { $id: id });
}

/**
 * Delete a model from DB. Returns filepath for disk deletion.
 */
export function deleteModel(id: number): string | null {
	const model = getModel(id);
	if (!model) return null;

	execute('DELETE FROM models WHERE id = $id', { $id: id });
	return model.filepath;
}

// --- Profiles CRUD ---

export function getProfiles(modelId: number): ProfileRow[] {
	return queryAll<ProfileRow>(
		'SELECT * FROM profiles WHERE model_id = $model_id ORDER BY created_at ASC',
		{ $model_id: modelId }
	);
}

export function getProfile(profileId: number): ProfileRow | null {
	return queryOne<ProfileRow>('SELECT * FROM profiles WHERE id = $id', { $id: profileId });
}

export function createProfile(modelId: number, profile: ProfileInput): number {
	const result = execute(
		`INSERT INTO profiles (model_id, name, gpu_layers, context_size, port, threads, batch_size, flash_attn, kv_cache_type, extra_flags)
		 VALUES ($model_id, $name, $gpu_layers, $context_size, $port, $threads, $batch_size, $flash_attn, $kv_cache_type, $extra_flags)`,
		{
			$model_id: modelId,
			$name: profile.name,
			$gpu_layers: profile.gpu_layers ?? null,
			$context_size: profile.context_size ?? null,
			$port: profile.port ?? 8080,
			$threads: profile.threads ?? null,
			$batch_size: profile.batch_size ?? null,
			$flash_attn: profile.flash_attn ?? 'auto',
			$kv_cache_type: profile.kv_cache_type ?? 'q8_0',
			$extra_flags: profile.extra_flags ?? null
		}
	);
	return Number(result.lastInsertRowid);
}

export function updateProfile(profileId: number, profile: ProfileInput): void {
	execute(
		`UPDATE profiles SET name = $name, gpu_layers = $gpu_layers, context_size = $context_size,
		 port = $port, threads = $threads, batch_size = $batch_size, flash_attn = $flash_attn,
		 kv_cache_type = $kv_cache_type, extra_flags = $extra_flags WHERE id = $id`,
		{
			$id: profileId,
			$name: profile.name,
			$gpu_layers: profile.gpu_layers ?? null,
			$context_size: profile.context_size ?? null,
			$port: profile.port ?? 8080,
			$threads: profile.threads ?? null,
			$batch_size: profile.batch_size ?? null,
			$flash_attn: profile.flash_attn ?? 'auto',
			$kv_cache_type: profile.kv_cache_type ?? 'q8_0',
			$extra_flags: profile.extra_flags ?? null
		}
	);
}

export function deleteProfile(profileId: number): void {
	execute('DELETE FROM profiles WHERE id = $id', { $id: profileId });
}

/**
 * Generate a default profile with recommended settings based on hardware.
 */
export async function generateDefaultProfile(modelId: number): Promise<ProfileInput> {
	const model = getModel(modelId);
	if (!model) throw new Error('Model not found');

	const hardware = getHardwareProfile();
	const totalVram = getUsableVram(hardware);

	// Build a minimal ModelInfo for recommendation functions
	const modelInfo: ModelInfo = {
		architecture: model.architecture ?? 'unknown',
		parameterCount: model.parameter_count,
		quantType: model.quant_type ?? 'Unknown',
		contextLength: model.context_length ?? 2048,
		embeddingLength: 0,
		blockCount: 0,
		headCount: 0,
		headCountKV: 0,
		fileSize: model.size_bytes ?? 0,
		metadata: {}
	};

	// Try to get full info from file for better recommendations
	try {
		const fullInfo = await getModelInfo(model.filepath);
		modelInfo.embeddingLength = fullInfo.embeddingLength;
		modelInfo.blockCount = fullInfo.blockCount;
		modelInfo.headCount = fullInfo.headCount;
		modelInfo.headCountKV = fullInfo.headCountKV;
	} catch {
		// Use partial info
	}

	// Priority: max GPU layers first, then fit context into remaining VRAM.
	// GPU layers matter far more for speed than large context.
	const minCtx = 2048;
	const { layers } = recommendGpuLayers(modelInfo, totalVram, minCtx);
	const ctxLen = recommendContextLength(modelInfo, totalVram, layers);

	// Batch size based on VRAM
	const totalVramMb = totalVram / (1024 * 1024);
	let batchSize: number;
	if (totalVramMb >= 16384) {
		batchSize = 2048;
	} else if (totalVramMb >= 8192) {
		batchSize = 1024;
	} else if (totalVramMb >= 4096) {
		batchSize = 512;
	} else {
		batchSize = 256;
	}

	return {
		name: 'Default',
		gpu_layers: layers,
		context_size: ctxLen || minCtx,
		port: 8080,
		threads: hardware.cpu.physical_cores > 0 ? hardware.cpu.physical_cores : null,
		batch_size: batchSize,
		flash_attn: 'auto',
		kv_cache_type: 'q8_0',
		extra_flags: null
	};
}
