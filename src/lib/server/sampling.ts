import { queryOne, execute } from './db';

export interface SamplingParams {
	temperature: number;
	top_p: number;
	top_k: number;
	min_p: number;
	repeat_penalty: number;
}

interface SamplingRow {
	id: number;
	model_id: number;
	temperature: number | null;
	top_p: number | null;
	top_k: number | null;
	min_p: number | null;
	repeat_penalty: number | null;
	source: string | null;
}

export const SAMPLING_DEFAULTS: SamplingParams = {
	temperature: 0.7,
	top_p: 0.95,
	top_k: 40,
	min_p: 0.05,
	repeat_penalty: 1.1
};

/**
 * Get sampling params for a model, filling nulls with defaults.
 */
export function getSamplingParams(modelId: number): SamplingParams & { source: string } {
	const row = getSamplingParamsRow(modelId);
	if (!row) {
		return { ...SAMPLING_DEFAULTS, source: 'default' };
	}

	return {
		temperature: row.temperature ?? SAMPLING_DEFAULTS.temperature,
		top_p: row.top_p ?? SAMPLING_DEFAULTS.top_p,
		top_k: row.top_k ?? SAMPLING_DEFAULTS.top_k,
		min_p: row.min_p ?? SAMPLING_DEFAULTS.min_p,
		repeat_penalty: row.repeat_penalty ?? SAMPLING_DEFAULTS.repeat_penalty,
		source: row.source ?? 'default'
	};
}

/**
 * Get the raw DB row with nulls preserved.
 */
export function getSamplingParamsRow(modelId: number): SamplingRow | null {
	return queryOne<SamplingRow>('SELECT * FROM sampling_params WHERE model_id = $model_id', {
		$model_id: modelId
	});
}

/**
 * Upsert sampling params for a model.
 */
export function setSamplingParams(
	modelId: number,
	params: Partial<SamplingParams>,
	source: string = 'user'
): void {
	execute(
		`INSERT INTO sampling_params (model_id, temperature, top_p, top_k, min_p, repeat_penalty, source)
		 VALUES ($model_id, $temperature, $top_p, $top_k, $min_p, $repeat_penalty, $source)
		 ON CONFLICT(model_id) DO UPDATE SET
			temperature = COALESCE($temperature, sampling_params.temperature),
			top_p = COALESCE($top_p, sampling_params.top_p),
			top_k = COALESCE($top_k, sampling_params.top_k),
			min_p = COALESCE($min_p, sampling_params.min_p),
			repeat_penalty = COALESCE($repeat_penalty, sampling_params.repeat_penalty),
			source = $source`,
		{
			$model_id: modelId,
			$temperature: params.temperature ?? null,
			$top_p: params.top_p ?? null,
			$top_k: params.top_k ?? null,
			$min_p: params.min_p ?? null,
			$repeat_penalty: params.repeat_penalty ?? null,
			$source: source
		}
	);
}
