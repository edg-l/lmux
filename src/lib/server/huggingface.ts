import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getSetting } from './settings';
import { parseQuantFromFilename } from './gguf';

const HF_API_BASE = 'https://huggingface.co/api';

export interface HfSearchResult {
	id: string;
	author: string;
	downloads: number;
	likes: number;
	trendingScore: number;
	lastModified: string;
	createdAt: string;
	pipelineTag: string | null;
	gated: boolean;
	tags: string[];
	license: string | null;
	baseModel: string | null;
	languages: string[];
	fileCount: number;
}

export interface HfFileInfo {
	filename: string;
	size: number;
	quantType: string | null;
	isMmproj: boolean;
}

/**
 * Resolve HuggingFace auth token with priority:
 * 1. HF_TOKEN env var
 * 2. ~/.cache/huggingface/token file
 * 3. Settings DB
 */
export function getHfToken(): string {
	const envToken = process.env.HF_TOKEN;
	if (envToken) return envToken;

	try {
		const filePath = join(homedir(), '.cache', 'huggingface', 'token');
		const fileToken = readFileSync(filePath, 'utf-8').trim();
		if (fileToken) return fileToken;
	} catch {
		// File doesn't exist or unreadable
	}

	const dbToken = getSetting('hf_token');
	if (dbToken) return dbToken;

	return '';
}

/**
 * Fetch wrapper that adds HF Authorization header if token is available.
 */
export async function hfFetch(url: string, options?: RequestInit): Promise<Response> {
	const token = getHfToken();
	const headers = new Headers(options?.headers);

	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}

	return fetch(url, { ...options, headers });
}

interface HfApiModel {
	id: string;
	author?: string;
	downloads?: number;
	likes?: number;
	trendingScore?: number;
	lastModified?: string;
	createdAt?: string;
	pipeline_tag?: string;
	gated?: boolean | string;
	tags?: string[];
	siblings?: Array<{ rfilename: string }>;
}

function parseModelResult(item: HfApiModel): HfSearchResult {
	const tags = item.tags ?? [];
	const license = tags.find((t) => t.startsWith('license:'))?.replace('license:', '') ?? null;
	const baseModel =
		tags.find((t) => t.startsWith('base_model:'))?.replace('base_model:', '') ?? null;
	const languages = tags.filter(
		(t) =>
			/^[a-z]{2}$/.test(t) ||
			t === 'multilingual' ||
			t === 'zh' ||
			t === 'en' ||
			t === 'ja' ||
			t === 'ko' ||
			t === 'de' ||
			t === 'fr' ||
			t === 'es'
	);

	return {
		id: item.id,
		author: item.author ?? item.id.split('/')[0] ?? '',
		downloads: item.downloads ?? 0,
		likes: item.likes ?? 0,
		trendingScore: item.trendingScore ?? 0,
		lastModified: item.lastModified ?? '',
		createdAt: item.createdAt ?? '',
		pipelineTag: item.pipeline_tag ?? null,
		gated: item.gated === true || item.gated === 'auto',
		tags: tags.filter(
			(t) =>
				!t.startsWith('license:') &&
				!t.startsWith('base_model:') &&
				!t.startsWith('dataset:') &&
				!t.startsWith('region:') &&
				t !== 'gguf' &&
				t !== 'endpoints_compatible' &&
				t !== 'conversational' &&
				!/^[a-z]{2}$/.test(t)
		),
		license,
		baseModel,
		languages,
		fileCount: item.siblings?.length ?? 0
	};
}

/**
 * Search HuggingFace for GGUF model repositories.
 */
export async function searchModels(query: string, limit = 20): Promise<HfSearchResult[]> {
	const params = new URLSearchParams({
		search: query,
		filter: 'gguf',
		sort: 'downloads',
		direction: '-1',
		limit: String(limit),
		full: 'true'
	});

	const res = await hfFetch(`${HF_API_BASE}/models?${params}`);
	if (!res.ok) {
		throw new Error(`HF search failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as HfApiModel[];
	return data.map(parseModelResult);
}

export interface GenerationConfig {
	temperature?: number;
	top_p?: number;
	top_k?: number;
	min_p?: number;
	repetition_penalty?: number;
}

/**
 * Fetch generation_config.json from a HuggingFace repo.
 * Returns null on 404 or any error.
 */
export async function fetchGenerationConfig(repoId: string): Promise<GenerationConfig | null> {
	try {
		const res = await hfFetch(`https://huggingface.co/${repoId}/raw/main/generation_config.json`);
		if (!res.ok) {
			res.body?.cancel();
			return null;
		}
		const data = await res.json();
		const config: GenerationConfig = {};
		if (typeof data.temperature === 'number') config.temperature = data.temperature;
		if (typeof data.top_p === 'number') config.top_p = data.top_p;
		if (typeof data.top_k === 'number') config.top_k = data.top_k;
		if (typeof data.min_p === 'number') config.min_p = data.min_p;
		if (typeof data.repetition_penalty === 'number')
			config.repetition_penalty = data.repetition_penalty;
		return Object.keys(config).length > 0 ? config : null;
	} catch {
		return null;
	}
}

/**
 * Fetch trending GGUF models from HuggingFace.
 */
export async function fetchTrendingModels(limit = 20): Promise<HfSearchResult[]> {
	const params = new URLSearchParams({
		filter: 'gguf',
		sort: 'trendingScore',
		direction: '-1',
		limit: String(limit),
		full: 'true'
	});

	const res = await hfFetch(`${HF_API_BASE}/models?${params}`);
	if (!res.ok) {
		throw new Error(`HF trending fetch failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as HfApiModel[];
	return data.map(parseModelResult);
}

/**
 * List GGUF files in a HuggingFace repository.
 */
export async function listRepoFiles(repoId: string): Promise<HfFileInfo[]> {
	const res = await hfFetch(`${HF_API_BASE}/models/${repoId}/tree/main`);
	if (!res.ok) {
		throw new Error(`HF tree fetch failed: ${res.status} ${res.statusText}`);
	}

	const entries = (await res.json()) as Array<{
		rfilename?: string;
		path?: string;
		size?: number;
		type?: string;
	}>;

	return entries
		.filter((entry) => {
			const name = entry.rfilename ?? entry.path ?? '';
			return name.endsWith('.gguf') && entry.type !== 'directory';
		})
		.map((entry) => {
			const filename = entry.rfilename ?? entry.path ?? '';
			const quant = parseQuantFromFilename(filename);
			return {
				filename,
				size: entry.size ?? 0,
				quantType: quant !== 'Unknown' ? quant : null,
				isMmproj: filename.includes('mmproj')
			};
		});
}
