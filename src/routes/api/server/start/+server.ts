import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModel, getProfile } from '$lib/server/models';
import { getSetting } from '$lib/server/settings';
import { startServer, detectLlamaServer } from '$lib/server/llama';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { modelId: number; profileId?: number };

	if (!body.modelId) {
		return json({ error: 'Missing modelId' }, { status: 400 });
	}

	const model = getModel(body.modelId);
	if (!model) {
		return json({ error: 'Model not found' }, { status: 404 });
	}

	// Resolve profile settings
	let gpuLayers = 0;
	let contextSize = 2048;
	let port = 8080;
	let threads: number | null = null;
	let batchSize: number | null = null;
	let flashAttn: string | null = 'auto';
	let kvCacheType: string | null = 'q8_0';
	let extraFlags = '';

	if (body.profileId) {
		const profile = getProfile(body.profileId);
		if (!profile) {
			return json({ error: 'Profile not found' }, { status: 404 });
		}
		gpuLayers = profile.gpu_layers ?? 0;
		contextSize = profile.context_size ?? 2048;
		port = profile.port;
		threads = profile.threads;
		batchSize = profile.batch_size;
		flashAttn = profile.flash_attn;
		kvCacheType = profile.kv_cache_type;
		extraFlags = profile.extra_flags ?? '';
	}

	// Resolve llama-server path
	let llamaServerPath = getSetting('llama_server_path');
	if (!llamaServerPath) {
		llamaServerPath = (await detectLlamaServer()) ?? '';
	}

	if (!llamaServerPath) {
		return json(
			{ error: 'llama-server binary not found. Set the path in Settings.' },
			{ status: 400 }
		);
	}

	const kvCacheDir = getSetting('kv_cache_dir');

	try {
		await startServer({
			modelPath: model.filepath,
			modelId: model.id,
			modelName: model.filename,
			gpuLayers,
			contextSize,
			port,
			threads,
			batchSize,
			flashAttn,
			kvCacheType,
			extraFlags: extraFlags || undefined,
			slotSavePath: kvCacheDir || undefined,
			llamaServerPath
		});

		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to start server';
		return json({ error: message }, { status: 500 });
	}
};
