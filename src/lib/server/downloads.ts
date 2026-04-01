import { existsSync, statSync, createWriteStream, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hfFetch, fetchGenerationConfig } from './huggingface';
import { getModelsDir } from './settings';
import { scanModels } from './models';
import { setSamplingParams } from './sampling';
import { queryOne } from './db';

export interface DownloadProgress {
	filename: string;
	totalBytes: number;
	downloadedBytes: number;
	speed: number;
	status: 'downloading' | 'completed' | 'cancelled' | 'error';
	error?: string;
}

interface ActiveDownload {
	abort: AbortController;
	progress: DownloadProgress;
	repoId: string;
}

const activeDownloads = new Map<string, ActiveDownload>();

/** Rolling window samples for speed calculation */
const speedSamples = new Map<string, Array<{ time: number; bytes: number }>>();

function generateDownloadId(repoId: string, filename: string): string {
	return `${repoId}/${filename}`.replace(/[^a-zA-Z0-9._/-]/g, '_');
}

function calculateSpeed(downloadId: string, currentBytes: number): number {
	const now = Date.now();
	let samples = speedSamples.get(downloadId);
	if (!samples) {
		samples = [];
		speedSamples.set(downloadId, samples);
	}

	samples.push({ time: now, bytes: currentBytes });

	// Keep only last 2 seconds of samples
	const cutoff = now - 2000;
	while (samples.length > 0 && samples[0].time < cutoff) {
		samples.shift();
	}

	if (samples.length < 2) return 0;

	const oldest = samples[0];
	const newest = samples[samples.length - 1];
	const timeDelta = (newest.time - oldest.time) / 1000;
	if (timeDelta <= 0) return 0;

	return (newest.bytes - oldest.bytes) / timeDelta;
}

export async function startDownload(repoId: string, filename: string): Promise<string> {
	const downloadId = generateDownloadId(repoId, filename);

	// Already downloading
	if (activeDownloads.has(downloadId)) {
		const existing = activeDownloads.get(downloadId)!;
		if (existing.progress.status === 'downloading') {
			return downloadId;
		}
	}

	const modelsDir = getModelsDir();
	const filepath = join(modelsDir, filename);

	// Prevent path traversal and directory separators
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		throw new Error('Invalid filename');
	}
	if (!resolve(filepath).startsWith(resolve(modelsDir) + '/')) {
		throw new Error('Invalid filename: path traversal detected');
	}

	const partialPath = filepath + '.partial';

	const abort = new AbortController();
	const progress: DownloadProgress = {
		filename,
		totalBytes: 0,
		downloadedBytes: 0,
		speed: 0,
		status: 'downloading'
	};

	activeDownloads.set(downloadId, { abort, progress, repoId });
	speedSamples.set(downloadId, []);

	// Check for existing partial file for resume
	let existingSize = 0;
	if (existsSync(partialPath)) {
		existingSize = statSync(partialPath).size;
	}

	const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
	const headers: Record<string, string> = {};
	if (existingSize > 0) {
		headers['Range'] = `bytes=${existingSize}-`;
	}

	// Run download asynchronously
	doDownload(
		downloadId,
		url,
		partialPath,
		filepath,
		existingSize,
		headers,
		abort.signal,
		progress,
		repoId,
		filename
	);

	return downloadId;
}

async function doDownload(
	downloadId: string,
	url: string,
	partialPath: string,
	finalPath: string,
	existingSize: number,
	headers: Record<string, string>,
	signal: AbortSignal,
	progress: DownloadProgress,
	repoId: string,
	_filename: string
): Promise<void> {
	try {
		const res = await hfFetch(url, { headers, signal });

		if (!res.ok && res.status !== 206) {
			res.body?.cancel();
			progress.status = 'error';
			progress.error = `HTTP ${res.status} ${res.statusText}`;
			return;
		}

		const contentLength = res.headers.get('content-length');
		const isResumed = res.status === 206;

		if (isResumed) {
			// Content-Range: bytes start-end/total
			const range = res.headers.get('content-range');
			if (range) {
				const total = parseInt(range.split('/')[1]);
				if (!isNaN(total)) progress.totalBytes = total;
			} else if (contentLength) {
				progress.totalBytes = existingSize + parseInt(contentLength);
			}
			progress.downloadedBytes = existingSize;
		} else {
			progress.totalBytes = contentLength ? parseInt(contentLength) : 0;
			progress.downloadedBytes = 0;
			// Not resumed, start fresh
			existingSize = 0;
		}

		if (!res.body) {
			progress.status = 'error';
			progress.error = 'No response body';
			return;
		}

		// Use append mode for resume, write mode for fresh downloads
		const writeStream = createWriteStream(partialPath, {
			flags: existingSize > 0 && isResumed ? 'a' : 'w'
		});

		const reader = res.body.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				writeStream.write(value);
				progress.downloadedBytes += value.byteLength;
				progress.speed = calculateSpeed(downloadId, progress.downloadedBytes);
			}

			await new Promise<void>((resolve, reject) => {
				writeStream.end(() => resolve());
				writeStream.on('error', reject);
			});

			// Rename partial to final (atomic, no extra disk usage)
			renameSync(partialPath, finalPath);

			progress.status = 'completed';

			// Scan model into DB and fetch generation config
			try {
				await scanModels();
				const model = queryOne<{ id: number }>('SELECT id FROM models WHERE filepath = $filepath', {
					$filepath: finalPath
				});
				if (model) {
					const genConfig = await fetchGenerationConfig(repoId);
					if (genConfig) {
						setSamplingParams(
							model.id,
							{
								temperature: genConfig.temperature,
								top_p: genConfig.top_p,
								top_k: genConfig.top_k,
								min_p: genConfig.min_p,
								repeat_penalty: genConfig.repetition_penalty
							},
							'huggingface'
						);
					}
				}
			} catch (e) {
				console.error('Post-download scan/config failed:', e);
			}
		} catch (e) {
			writeStream.end();
			if (signal.aborted) {
				progress.status = 'cancelled';
			} else {
				progress.status = 'error';
				progress.error = e instanceof Error ? e.message : 'Download failed';
			}
		}
	} catch (e) {
		if (signal.aborted) {
			progress.status = 'cancelled';
		} else {
			progress.status = 'error';
			progress.error = e instanceof Error ? e.message : 'Download failed';
		}
	} finally {
		speedSamples.delete(downloadId);
		// Clean up completed/failed/cancelled downloads after 30s so UI can show final state
		setTimeout(() => activeDownloads.delete(downloadId), 30_000);
	}
}

export function cancelDownload(downloadId: string): void {
	const download = activeDownloads.get(downloadId);
	if (download && download.progress.status === 'downloading') {
		download.abort.abort();
		download.progress.status = 'cancelled';
	}
}

export function getDownloadProgress(downloadId: string): DownloadProgress | null {
	const download = activeDownloads.get(downloadId);
	return download?.progress ?? null;
}

export function getAllDownloads(): Map<string, DownloadProgress> {
	const result = new Map<string, DownloadProgress>();
	for (const [id, download] of activeDownloads) {
		result.set(id, download.progress);
	}
	return result;
}
