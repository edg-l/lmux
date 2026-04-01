import { describe, it, expect } from 'vitest';
import { parseGgufFromBuffer, parseQuantFromFilename, FILE_TYPE_MAP } from './gguf';

/**
 * Build a synthetic GGUF header buffer with the given metadata KV pairs.
 */
function buildGgufBuffer(
	kvPairs: Array<{ key: string; type: number; value: unknown }>,
	options?: { tensorCount?: number; version?: number }
): ArrayBuffer {
	const encoder = new TextEncoder();
	const tensorCount = options?.tensorCount ?? 42;
	const version = options?.version ?? 3;

	// Calculate size needed (generous overestimate)
	let estimatedSize = 4 + 4 + 8 + 8; // magic + version + tensorCount + kvCount
	for (const kv of kvPairs) {
		estimatedSize += 8 + kv.key.length; // key string
		estimatedSize += 4; // value type
		estimatedSize += 1024; // generous value estimate
	}

	const buf = new ArrayBuffer(estimatedSize);
	const view = new DataView(buf);
	let offset = 0;

	function writeUint32(val: number) {
		view.setUint32(offset, val, true);
		offset += 4;
	}

	function writeUint64(val: number | bigint) {
		view.setBigUint64(offset, BigInt(val), true);
		offset += 8;
	}

	function writeString(str: string) {
		const bytes = encoder.encode(str);
		writeUint64(bytes.length);
		new Uint8Array(buf, offset, bytes.length).set(bytes);
		offset += bytes.length;
	}

	function writeValue(type: number, value: unknown) {
		switch (type) {
			case 0: // UINT8
				view.setUint8(offset, value as number);
				offset += 1;
				break;
			case 1: // INT8
				view.setInt8(offset, value as number);
				offset += 1;
				break;
			case 2: // UINT16
				view.setUint16(offset, value as number, true);
				offset += 2;
				break;
			case 3: // INT16
				view.setInt16(offset, value as number, true);
				offset += 2;
				break;
			case 4: // UINT32
				writeUint32(value as number);
				break;
			case 5: // INT32
				view.setInt32(offset, value as number, true);
				offset += 4;
				break;
			case 6: // FLOAT32
				view.setFloat32(offset, value as number, true);
				offset += 4;
				break;
			case 7: // BOOL
				view.setUint8(offset, value ? 1 : 0);
				offset += 1;
				break;
			case 8: // STRING
				writeString(value as string);
				break;
			case 10: // UINT64
				writeUint64(value as number);
				break;
			case 11: // INT64
				view.setBigInt64(offset, BigInt(value as number), true);
				offset += 8;
				break;
			case 12: // FLOAT64
				view.setFloat64(offset, value as number, true);
				offset += 8;
				break;
		}
	}

	// Magic "GGUF"
	writeUint32(0x46554747);
	// Version
	writeUint32(version);
	// Tensor count
	writeUint64(tensorCount);
	// KV count
	writeUint64(kvPairs.length);

	for (const kv of kvPairs) {
		writeString(kv.key);
		writeUint32(kv.type);
		writeValue(kv.type, kv.value);
	}

	return buf.slice(0, offset);
}

describe('GGUF parser', () => {
	it('parses a minimal valid GGUF header with no metadata', () => {
		const buf = buildGgufBuffer([], { tensorCount: 10, version: 3 });
		const result = parseGgufFromBuffer(buf);

		expect(result.version).toBe(3);
		expect(result.tensorCount).toBe(10);
		expect(Object.keys(result.metadata)).toHaveLength(0);
	});

	it('parses string metadata values', () => {
		const buf = buildGgufBuffer([{ key: 'general.architecture', type: 8, value: 'llama' }]);
		const result = parseGgufFromBuffer(buf);

		expect(result.metadata['general.architecture']).toBe('llama');
	});

	it('parses uint32 metadata values', () => {
		const buf = buildGgufBuffer([{ key: 'llama.context_length', type: 4, value: 4096 }]);
		const result = parseGgufFromBuffer(buf);

		expect(result.metadata['llama.context_length']).toBe(4096);
	});

	it('parses multiple metadata KV pairs', () => {
		const buf = buildGgufBuffer([
			{ key: 'general.architecture', type: 8, value: 'llama' },
			{ key: 'general.file_type', type: 4, value: 15 },
			{ key: 'llama.context_length', type: 4, value: 8192 },
			{ key: 'llama.block_count', type: 4, value: 32 },
			{ key: 'llama.embedding_length', type: 4, value: 4096 },
			{ key: 'llama.attention.head_count', type: 4, value: 32 },
			{ key: 'llama.attention.head_count_kv', type: 4, value: 8 }
		]);

		const result = parseGgufFromBuffer(buf);

		expect(result.metadata['general.architecture']).toBe('llama');
		expect(result.metadata['general.file_type']).toBe(15);
		expect(result.metadata['llama.context_length']).toBe(8192);
		expect(result.metadata['llama.block_count']).toBe(32);
		expect(result.metadata['llama.embedding_length']).toBe(4096);
		expect(result.metadata['llama.attention.head_count']).toBe(32);
		expect(result.metadata['llama.attention.head_count_kv']).toBe(8);
	});

	it('parses bool metadata values', () => {
		const buf = buildGgufBuffer([{ key: 'some.flag', type: 7, value: true }]);
		const result = parseGgufFromBuffer(buf);

		expect(result.metadata['some.flag']).toBe(true);
	});

	it('parses float32 metadata values', () => {
		const buf = buildGgufBuffer([{ key: 'some.float', type: 6, value: 3.14 }]);
		const result = parseGgufFromBuffer(buf);

		expect(result.metadata['some.float']).toBeCloseTo(3.14, 2);
	});

	it('rejects invalid magic bytes', () => {
		const buf = new ArrayBuffer(24);
		const view = new DataView(buf);
		view.setUint32(0, 0x00000000, true);

		expect(() => parseGgufFromBuffer(buf)).toThrow('Invalid GGUF magic');
	});

	it('rejects unsupported version', () => {
		const buf = new ArrayBuffer(24);
		const view = new DataView(buf);
		view.setUint32(0, 0x46554747, true); // magic
		view.setUint32(4, 99, true); // bad version

		expect(() => parseGgufFromBuffer(buf)).toThrow('Unsupported GGUF version');
	});

	it('accepts version 2', () => {
		const buf = buildGgufBuffer([], { version: 2 });
		const result = parseGgufFromBuffer(buf);
		expect(result.version).toBe(2);
	});
});

describe('FILE_TYPE_MAP', () => {
	it('maps common file types to quant names', () => {
		expect(FILE_TYPE_MAP[0]).toBe('F32');
		expect(FILE_TYPE_MAP[1]).toBe('F16');
		expect(FILE_TYPE_MAP[2]).toBe('Q4_0');
		expect(FILE_TYPE_MAP[7]).toBe('Q8_0');
		expect(FILE_TYPE_MAP[15]).toBe('Q4_K_M');
		expect(FILE_TYPE_MAP[17]).toBe('Q5_K_M');
		expect(FILE_TYPE_MAP[18]).toBe('Q6_K');
	});

	it('returns undefined for unknown file types', () => {
		expect(FILE_TYPE_MAP[999]).toBeUndefined();
	});
});

describe('parseQuantFromFilename', () => {
	it('extracts quant type from standard filenames', () => {
		expect(parseQuantFromFilename('model-Q4_K_M.gguf')).toBe('Q4_K_M');
		expect(parseQuantFromFilename('llama-3-8b-Q5_K_S.gguf')).toBe('Q5_K_S');
		expect(parseQuantFromFilename('model_Q8_0.gguf')).toBe('Q8_0');
	});

	it('extracts IQ quant types', () => {
		expect(parseQuantFromFilename('model-IQ3_XXS.gguf')).toBe('IQ3_XXS');
		expect(parseQuantFromFilename('model-IQ4_NL.gguf')).toBe('IQ4_NL');
	});

	it('extracts F16/F32', () => {
		expect(parseQuantFromFilename('model-F16.gguf')).toBe('F16');
		expect(parseQuantFromFilename('model-F32.gguf')).toBe('F32');
	});

	it('returns Unknown for filenames without quant info', () => {
		expect(parseQuantFromFilename('model.gguf')).toBe('Unknown');
		expect(parseQuantFromFilename('random-file.bin')).toBe('Unknown');
	});
});
