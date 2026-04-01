import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from './db';

const DEFAULT_MODELS_DIR = join(homedir(), '.local', 'share', 'lmux', 'models');
const HF_CACHE_DIR = join(homedir(), '.cache', 'huggingface', 'hub');

const DEFAULTS: Record<string, string> = {
	models_dir: DEFAULT_MODELS_DIR,
	llama_server_path: '',
	hf_token: '',
	vram_headroom_mb: '512'
};

export function getSetting(key: string): string {
	const db = getDb();
	const row = db.prepare('SELECT value FROM settings WHERE key = $key').get({ $key: key }) as
		| { value: string }
		| undefined;

	if (row) return row.value;

	if (key in DEFAULTS) {
		setSetting(key, DEFAULTS[key]);
		return DEFAULTS[key];
	}

	return '';
}

export function setSetting(key: string, value: string): void {
	const db = getDb();
	db.prepare(
		'INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value'
	).run({
		$key: key,
		$value: value
	});
}

export function getAllSettings(): Record<string, string> {
	const db = getDb();
	const rows = db.prepare('SELECT key, value FROM settings').all() as {
		key: string;
		value: string;
	}[];
	const result: Record<string, string> = {};

	for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
		result[key] = defaultValue;
	}

	for (const row of rows) {
		result[row.key] = row.value;
	}

	return result;
}

export function getModelsDir(): string {
	const dir = getSetting('models_dir');
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Returns the HuggingFace cache hub directory (~/.cache/huggingface/hub).
 * Returns null if the directory doesn't exist.
 */
export function getHfCacheDir(): string | null {
	const envCache = process.env.HF_HOME;
	const dir = envCache ? join(envCache, 'hub') : HF_CACHE_DIR;
	return existsSync(dir) ? dir : null;
}
