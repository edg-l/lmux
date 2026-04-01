import { queryAll, queryOne, execute } from './db';

export interface Preset {
	id: number;
	name: string;
	system_prompt: string | null;
	temperature: number | null;
	top_p: number | null;
	top_k: number | null;
	min_p: number | null;
	repeat_penalty: number | null;
	thinking_budget: number | null;
	created_at: string;
}

export interface PresetInput {
	name: string;
	system_prompt?: string | null;
	temperature?: number | null;
	top_p?: number | null;
	top_k?: number | null;
	min_p?: number | null;
	repeat_penalty?: number | null;
	thinking_budget?: number | null;
}

export function listPresets(): Preset[] {
	return queryAll<Preset>('SELECT * FROM presets ORDER BY name ASC');
}

export function getPreset(id: number): Preset | null {
	return queryOne<Preset>('SELECT * FROM presets WHERE id = $id', { $id: id });
}

export function createPreset(data: PresetInput): number {
	const result = execute(
		`INSERT INTO presets (name, system_prompt, temperature, top_p, top_k, min_p, repeat_penalty, thinking_budget)
		 VALUES ($name, $system_prompt, $temperature, $top_p, $top_k, $min_p, $repeat_penalty, $thinking_budget)`,
		{
			$name: data.name,
			$system_prompt: data.system_prompt ?? null,
			$temperature: data.temperature ?? null,
			$top_p: data.top_p ?? null,
			$top_k: data.top_k ?? null,
			$min_p: data.min_p ?? null,
			$repeat_penalty: data.repeat_penalty ?? null,
			$thinking_budget: data.thinking_budget ?? null
		}
	);
	return Number(result.lastInsertRowid);
}

export function updatePreset(id: number, data: PresetInput): void {
	execute(
		`UPDATE presets SET name = $name, system_prompt = $system_prompt, temperature = $temperature,
		 top_p = $top_p, top_k = $top_k, min_p = $min_p, repeat_penalty = $repeat_penalty,
		 thinking_budget = $thinking_budget WHERE id = $id`,
		{
			$id: id,
			$name: data.name,
			$system_prompt: data.system_prompt ?? null,
			$temperature: data.temperature ?? null,
			$top_p: data.top_p ?? null,
			$top_k: data.top_k ?? null,
			$min_p: data.min_p ?? null,
			$repeat_penalty: data.repeat_penalty ?? null,
			$thinking_budget: data.thinking_budget ?? null
		}
	);
}

export function deletePreset(id: number): void {
	execute('DELETE FROM presets WHERE id = $id', { $id: id });
}
