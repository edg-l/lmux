import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllSettings, setSetting } from '$lib/server/settings';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function detectHfTokenSource(): string | null {
	if (process.env.HF_TOKEN) return 'HF_TOKEN env var';
	const filePath = join(homedir(), '.cache', 'huggingface', 'token');
	if (existsSync(filePath)) {
		try {
			const token = readFileSync(filePath, 'utf-8').trim();
			if (token) return '~/.cache/huggingface/token';
		} catch {
			// unreadable
		}
	}
	return null;
}

export const GET: RequestHandler = async () => {
	const settings = getAllSettings();
	return json({
		...settings,
		hf_token_source: settings.hf_token ? 'settings' : detectHfTokenSource()
	});
};

const ALLOWED_KEYS = new Set([
	'models_dir',
	'llama_server_path',
	'hf_token',
	'tools_enabled',
	'searxng_url',
	'kv_cache_dir',
	'system_prompt'
]);

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { key: string; value: string };
	if (!body.key) {
		return json({ error: 'Missing key' }, { status: 400 });
	}
	if (!ALLOWED_KEYS.has(body.key)) {
		return json({ error: 'Unknown setting key' }, { status: 400 });
	}

	setSetting(body.key, body.value);
	return json({ ok: true });
};
