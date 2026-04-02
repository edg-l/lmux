import { describe, it, expect } from 'bun:test';
import type { ModelInfo } from './gguf';
import {
	estimateVram,
	recommendGpuLayers,
	recommendContextLength,
	assessFit,
	recommendQuant
} from './recommendations';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * A Llama-like 7B model with Q4_K_M quantization.
 * 32 layers, 32 heads, 8 KV heads (GQA ratio 0.25), 4096 embedding dim.
 * ~4GB file size for Q4_K_M.
 */
function makeLlama7bInfo(overrides?: Partial<ModelInfo>): ModelInfo {
	return {
		architecture: 'llama',
		parameterCount: 7_000_000_000,
		quantType: 'Q4_K_M',
		contextLength: 8192,
		embeddingLength: 4096,
		blockCount: 32,
		headCount: 32,
		headCountKV: 8,
		kvLayerCount: 32,
		fileSize: 4 * GB,
		metadata: {},
		...overrides
	};
}

describe('estimateVram', () => {
	it('calculates model VRAM as file size', () => {
		const info = makeLlama7bInfo();
		const est = estimateVram(info, 4096);

		expect(est.modelVram).toBe(4 * GB);
	});

	it('calculates KV cache VRAM correctly', () => {
		const info = makeLlama7bInfo();
		// kvPerToken = 2 * kvLayerCount(32) * (8/32) * 4096 * 1 = 65536 (q8_0: 1 byte/element)
		const kvPerToken = 2 * 32 * (8 / 32) * 4096 * 1;
		expect(kvPerToken).toBe(65536);

		const est = estimateVram(info, 4096);
		expect(est.kvCacheVram).toBe(kvPerToken * 4096);
	});

	it('returns total as sum of model and KV cache VRAM', () => {
		const info = makeLlama7bInfo();
		const est = estimateVram(info, 4096);

		expect(est.totalVram).toBe(est.modelVram + est.kvCacheVram);
	});

	it('scales KV cache with context length', () => {
		const info = makeLlama7bInfo();
		const est1 = estimateVram(info, 2048);
		const est2 = estimateVram(info, 4096);

		expect(est2.kvCacheVram).toBe(est1.kvCacheVram * 2);
	});

	it('handles GQA ratio of 1 (MHA) correctly', () => {
		const info = makeLlama7bInfo({ headCount: 32, headCountKV: 32 });
		const est = estimateVram(info, 1024);

		// kvPerToken = 2 * 32 * (32/32) * 4096 * 1 = 262144 (q8_0: 1 byte/element)
		const kvPerToken = 2 * 32 * 1 * 4096 * 1;
		expect(est.kvCacheVram).toBe(kvPerToken * 1024);
	});

	it('uses kvLayerCount for hybrid SSM models', () => {
		// Hybrid model: 32 blocks, but only 8 attention layers (kvLayerCount=8)
		const info = makeLlama7bInfo({ blockCount: 32, kvLayerCount: 8 });
		const est = estimateVram(info, 4096);

		// kvPerToken = 2 * 8 * (8/32) * 4096 * 1 = 16384
		const kvPerToken = 2 * 8 * (8 / 32) * 4096 * 1;
		expect(est.kvCacheVram).toBe(kvPerToken * 4096);

		// Should be 1/4 of a non-hybrid with same blockCount
		const nonHybrid = makeLlama7bInfo({ blockCount: 32, kvLayerCount: 32 });
		const estNonHybrid = estimateVram(nonHybrid, 4096);
		expect(est.kvCacheVram).toBe(estNonHybrid.kvCacheVram / 4);
	});
});

describe('recommendGpuLayers', () => {
	it('offloads all layers when VRAM is plentiful', () => {
		const info = makeLlama7bInfo();
		const result = recommendGpuLayers(info, 24 * GB, 4096);

		expect(result.layers).toBe(33); // 32 blocks + 1 output layer
		expect(result.offloadPercentage).toBe(100);
	});

	it('offloads partial layers when VRAM is limited', () => {
		const info = makeLlama7bInfo();
		// Per-layer = 4GB / 32 = 128MB
		// KV cache at 4096 ctx (q8_0) = 65536 * 4096 = 256MB
		// Available: 2GB. Usable = 2GB - 512MB(headroom) - 256MB(kv) = 1.25GB = 1280MB
		// Layers = floor(1280MB / 128MB) = 10
		const result = recommendGpuLayers(info, 2 * GB, 4096);

		expect(result.layers).toBe(10);
		expect(result.offloadPercentage).toBeCloseTo(30.3, 1); // 10/33 layers
	});

	it('returns 0 layers when nothing fits', () => {
		const info = makeLlama7bInfo();
		const result = recommendGpuLayers(info, 256 * MB, 4096);

		expect(result.layers).toBe(0);
		expect(result.offloadPercentage).toBe(0);
	});

	it('handles zero block count gracefully', () => {
		const info = makeLlama7bInfo({ blockCount: 0 });
		const result = recommendGpuLayers(info, 24 * GB, 4096);

		expect(result.layers).toBe(0);
		expect(result.offloadPercentage).toBe(0);
	});
});

describe('recommendContextLength', () => {
	it('recommends full context when VRAM is plentiful', () => {
		const info = makeLlama7bInfo();
		// All 32 layers on GPU, plenty of VRAM
		const ctx = recommendContextLength(info, 24 * GB, 32);

		expect(ctx).toBe(8192); // clamped to model's trained context
	});

	it('recommends a power of 2', () => {
		const info = makeLlama7bInfo({ contextLength: 131072 });
		const ctx = recommendContextLength(info, 8 * GB, 32);

		// Should be a power of 2
		expect(ctx).toBeGreaterThan(0);
		expect(Math.log2(ctx) % 1).toBe(0);
	});

	it('returns 0 when no VRAM remains', () => {
		const info = makeLlama7bInfo();
		// Model layers take all VRAM plus headroom
		const ctx = recommendContextLength(info, 1 * MB, 32);

		expect(ctx).toBe(0);
	});

	it('scales down context with fewer available VRAM', () => {
		const info = makeLlama7bInfo({ contextLength: 131072 });
		const ctxBig = recommendContextLength(info, 16 * GB, 32);
		const ctxSmall = recommendContextLength(info, 6 * GB, 32);

		expect(ctxBig).toBeGreaterThanOrEqual(ctxSmall);
	});
});

describe('assessFit', () => {
	it('returns fits when file size + 2GB < available VRAM', () => {
		expect(assessFit(4 * GB, 8 * GB)).toBe('fits');
	});

	it('returns tight when file fits but headroom < 2GB', () => {
		expect(assessFit(4 * GB, 5 * GB)).toBe('tight');
	});

	it('returns no_fit when file size >= available VRAM', () => {
		expect(assessFit(8 * GB, 8 * GB)).toBe('no_fit');
		expect(assessFit(10 * GB, 8 * GB)).toBe('no_fit');
	});

	it('handles exact boundary: file + 2GB == available', () => {
		// fileSizeBytes + 2GB < availableVramBytes is false when equal
		expect(assessFit(6 * GB, 8 * GB)).toBe('tight');
	});
});

describe('recommendQuant', () => {
	const variants = [
		{ filename: 'model-Q8_0.gguf', size: 8 * GB, quantType: 'Q8_0' },
		{ filename: 'model-Q5_K_M.gguf', size: 5 * GB, quantType: 'Q5_K_M' },
		{ filename: 'model-Q4_K_M.gguf', size: 4 * GB, quantType: 'Q4_K_M' },
		{ filename: 'model-Q2_K.gguf', size: 2 * GB, quantType: 'Q2_K' }
	];

	it('recommends highest quality that fits with 2GB headroom', () => {
		// 12GB available: Q8_0 (8GB + 2GB = 10GB) fits
		expect(recommendQuant(variants, 12 * GB)).toBe('Q8_0');
	});

	it('falls back to smaller quant when larger does not fit', () => {
		// 6.5GB available: Q4_K_M (4GB + 2GB = 6GB) fits, Q5_K_M (5+2=7) does not
		expect(recommendQuant(variants, 6.5 * GB)).toBe('Q4_K_M');
	});

	it('returns null when nothing fits', () => {
		expect(recommendQuant(variants, 2 * GB)).toBeNull();
	});

	it('handles unsorted input', () => {
		const unsorted = [
			{ filename: 'model-Q2_K.gguf', size: 2 * GB, quantType: 'Q2_K' },
			{ filename: 'model-Q8_0.gguf', size: 8 * GB, quantType: 'Q8_0' },
			{ filename: 'model-Q4_K_M.gguf', size: 4 * GB, quantType: 'Q4_K_M' }
		];

		expect(recommendQuant(unsorted, 12 * GB)).toBe('Q8_0');
	});

	it('handles empty variants', () => {
		expect(recommendQuant([], 12 * GB)).toBeNull();
	});
});
