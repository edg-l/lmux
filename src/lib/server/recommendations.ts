import type { ModelInfo } from './gguf';

const HEADROOM_BYTES = 512 * 1024 * 1024; // 512MB
const COMFORTABLE_HEADROOM = 2 * 1024 * 1024 * 1024; // 2GB

export interface VramEstimate {
	modelVram: number;
	kvCacheVram: number;
	totalVram: number;
}

/**
 * Estimate VRAM usage for a model at a given context length.
 *
 * - Model weights VRAM is approximately equal to the GGUF file size.
 * - KV cache per token = 2 * blockCount * (headCountKV / headCount) * embeddingLength * 2 bytes (FP16)
 *   The first `2 *` accounts for both K and V caches.
 *   (headCountKV / headCount) is the GQA ratio.
 *   Assumes q8_0 KV cache quantization (1 byte per element instead of 2 for FP16).
 */
export function estimateVram(modelInfo: ModelInfo, contextLength: number): VramEstimate {
	const modelVram = modelInfo.fileSize;

	const gqaRatio = modelInfo.headCount > 0 ? modelInfo.headCountKV / modelInfo.headCount : 1;

	// 2 * (K + V) * blockCount * gqaRatio * embeddingLength * 1 byte (q8_0)
	const kvPerToken = 2 * modelInfo.blockCount * gqaRatio * modelInfo.embeddingLength * 1;

	const kvCacheVram = kvPerToken * contextLength;

	return {
		modelVram,
		kvCacheVram,
		totalVram: modelVram + kvCacheVram
	};
}

/**
 * Recommend how many GPU layers to offload based on available VRAM.
 *
 * Per-layer VRAM is estimated as fileSize / blockCount.
 * Subtracts 512MB headroom and KV cache VRAM, then fits as many layers as possible.
 */
export function recommendGpuLayers(
	modelInfo: ModelInfo,
	availableVramBytes: number,
	contextLength: number
): { layers: number; offloadPercentage: number } {
	if (modelInfo.blockCount <= 0) {
		return { layers: 0, offloadPercentage: 0 };
	}

	const { kvCacheVram } = estimateVram(modelInfo, contextLength);
	const perLayerVram = modelInfo.fileSize / modelInfo.blockCount;
	const usablVram = availableVramBytes - HEADROOM_BYTES - kvCacheVram;

	if (usablVram <= 0) {
		return { layers: 0, offloadPercentage: 0 };
	}

	const layers = Math.min(Math.floor(usablVram / perLayerVram), modelInfo.blockCount);
	const offloadPercentage = (layers / modelInfo.blockCount) * 100;

	return { layers, offloadPercentage };
}

/**
 * Recommend the maximum context length that fits in available VRAM
 * given a specific number of GPU layers.
 *
 * Finds the largest power-of-2 context length that fits, clamped
 * to the model's trained context length.
 */
export function recommendContextLength(
	modelInfo: ModelInfo,
	availableVramBytes: number,
	gpuLayers: number
): number {
	if (modelInfo.blockCount <= 0 || modelInfo.headCount <= 0) {
		return 0;
	}

	const modelLayersVram = (gpuLayers / modelInfo.blockCount) * modelInfo.fileSize;

	const remaining = availableVramBytes - modelLayersVram - HEADROOM_BYTES;
	if (remaining <= 0) return 0;

	const gqaRatio = modelInfo.headCountKV / modelInfo.headCount;
	const kvPerToken = 2 * modelInfo.blockCount * gqaRatio * modelInfo.embeddingLength * 1; // q8_0

	if (kvPerToken <= 0) return 0;

	const maxTokens = Math.floor(remaining / kvPerToken);
	if (maxTokens <= 0) return 0;

	// Round down to nearest power of 2
	const power = Math.floor(Math.log2(maxTokens));
	const contextLength = Math.pow(2, power);

	// Clamp to the model's trained context length
	return Math.min(contextLength, modelInfo.contextLength);
}

export type FitLevel = 'fits' | 'tight' | 'no_fit';

/**
 * Assess how well a model fits in available VRAM based on file size.
 *
 * - 'fits': file size + 2GB < available VRAM (comfortable headroom)
 * - 'tight': file size < available VRAM but headroom < 2GB
 * - 'no_fit': file size >= available VRAM
 */
export function assessFit(fileSizeBytes: number, availableVramBytes: number): FitLevel {
	if (fileSizeBytes >= availableVramBytes) {
		return 'no_fit';
	}
	if (fileSizeBytes + COMFORTABLE_HEADROOM < availableVramBytes) {
		return 'fits';
	}
	return 'tight';
}

/**
 * Recommend the best quant variant that fits comfortably in VRAM.
 *
 * Sorts variants by size descending (larger = higher quality) and returns
 * the first (largest) variant where size + 2GB <= availableVram.
 * Returns null if nothing fits.
 */
export function recommendQuant(
	variants: Array<{ filename: string; size: number; quantType: string }>,
	availableVramBytes: number
): string | null {
	const sorted = [...variants].sort((a, b) => b.size - a.size);

	for (const variant of sorted) {
		if (variant.size + COMFORTABLE_HEADROOM <= availableVramBytes) {
			return variant.quantType;
		}
	}

	return null;
}
