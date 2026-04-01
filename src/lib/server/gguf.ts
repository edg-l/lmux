import { openSync, readSync, closeSync, statSync } from 'node:fs';

export interface GgufMetadata {
	version: number;
	tensorCount: number;
	metadata: Record<string, unknown>;
}

export interface ModelInfo {
	architecture: string;
	parameterCount: number | null;
	quantType: string;
	contextLength: number;
	embeddingLength: number;
	blockCount: number;
	headCount: number;
	headCountKV: number;
	fileSize: number;
	metadata: Record<string, unknown>;
}

const GGUF_MAGIC = 0x46554747; // "GGUF" in LE

enum GgufValueType {
	UINT8 = 0,
	INT8 = 1,
	UINT16 = 2,
	INT16 = 3,
	UINT32 = 4,
	INT32 = 5,
	FLOAT32 = 6,
	BOOL = 7,
	STRING = 8,
	ARRAY = 9,
	UINT64 = 10,
	INT64 = 11,
	FLOAT64 = 12
}

export const FILE_TYPE_MAP: Record<number, string> = {
	0: 'F32',
	1: 'F16',
	2: 'Q4_0',
	3: 'Q4_1',
	7: 'Q8_0',
	8: 'Q8_1',
	10: 'Q2_K',
	11: 'Q3_K_S',
	12: 'Q3_K_M',
	13: 'Q3_K_L',
	14: 'Q4_K_S',
	15: 'Q4_K_M',
	16: 'Q5_K_S',
	17: 'Q5_K_M',
	18: 'Q6_K',
	26: 'IQ2_XXS',
	27: 'IQ2_XS',
	28: 'IQ3_XXS',
	29: 'IQ1_S',
	30: 'IQ4_NL',
	31: 'IQ3_S',
	32: 'IQ2_S',
	33: 'IQ4_XS',
	34: 'IQ1_M',
	35: 'BF16',
	36: 'IQ3_M',
	37: 'IQ1_M',
	38: 'MXFP4_MOE',
	39: 'MXFP6_MOE',
	40: 'MXFP4_1x32',
	41: 'MXFP6_1x32'
};

class BufferReader {
	private view: DataView;
	private offset: number;

	constructor(buffer: ArrayBuffer) {
		this.view = new DataView(buffer);
		this.offset = 0;
	}

	get position(): number {
		return this.offset;
	}

	get remaining(): number {
		return this.view.byteLength - this.offset;
	}

	readUint8(): number {
		const val = this.view.getUint8(this.offset);
		this.offset += 1;
		return val;
	}

	readInt8(): number {
		const val = this.view.getInt8(this.offset);
		this.offset += 1;
		return val;
	}

	readUint16(): number {
		const val = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return val;
	}

	readInt16(): number {
		const val = this.view.getInt16(this.offset, true);
		this.offset += 2;
		return val;
	}

	readUint32(): number {
		const val = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return val;
	}

	readInt32(): number {
		const val = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return val;
	}

	readUint64(): bigint {
		const val = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return val;
	}

	readInt64(): bigint {
		const val = this.view.getBigInt64(this.offset, true);
		this.offset += 8;
		return val;
	}

	readFloat32(): number {
		const val = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return val;
	}

	readFloat64(): number {
		const val = this.view.getFloat64(this.offset, true);
		this.offset += 8;
		return val;
	}

	readString(): string {
		const len = Number(this.readUint64());
		const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
		this.offset += len;
		return new TextDecoder().decode(bytes);
	}

	readValue(type: GgufValueType): unknown {
		switch (type) {
			case GgufValueType.UINT8:
				return this.readUint8();
			case GgufValueType.INT8:
				return this.readInt8();
			case GgufValueType.UINT16:
				return this.readUint16();
			case GgufValueType.INT16:
				return this.readInt16();
			case GgufValueType.UINT32:
				return this.readUint32();
			case GgufValueType.INT32:
				return this.readInt32();
			case GgufValueType.FLOAT32:
				return this.readFloat32();
			case GgufValueType.BOOL:
				return this.readUint8() !== 0;
			case GgufValueType.STRING:
				return this.readString();
			case GgufValueType.ARRAY: {
				const elemType = this.readUint32() as GgufValueType;
				const count = Number(this.readUint64());
				const arr: unknown[] = [];
				for (let i = 0; i < count; i++) {
					arr.push(this.readValue(elemType));
				}
				return arr;
			}
			case GgufValueType.UINT64:
				return Number(this.readUint64());
			case GgufValueType.INT64:
				return Number(this.readInt64());
			case GgufValueType.FLOAT64:
				return this.readFloat64();
			default:
				throw new Error(`Unknown GGUF value type: ${type}`);
		}
	}
}

/**
 * Parse GGUF header from a buffer. Exported for testing with synthetic data.
 */
export function parseGgufFromBuffer(buffer: ArrayBuffer): GgufMetadata {
	const reader = new BufferReader(buffer);

	const magic = reader.readUint32();
	if (magic !== GGUF_MAGIC) {
		throw new Error(
			`Invalid GGUF magic: 0x${magic.toString(16).padStart(8, '0')} (expected 0x${GGUF_MAGIC.toString(16).padStart(8, '0')})`
		);
	}

	const version = reader.readUint32();
	if (version < 2 || version > 3) {
		throw new Error(`Unsupported GGUF version: ${version} (expected 2 or 3)`);
	}

	const tensorCount = Number(reader.readUint64());
	const kvCount = Number(reader.readUint64());

	const metadata: Record<string, unknown> = {};
	for (let i = 0; i < kvCount; i++) {
		const key = reader.readString();
		const valueType = reader.readUint32() as GgufValueType;
		const value = reader.readValue(valueType);
		metadata[key] = value;
	}

	return { version, tensorCount, metadata };
}

/**
 * Parse GGUF metadata from a file. Progressively reads larger chunks
 * if the header exceeds the initial buffer (models with tokenizer data
 * or chat templates can have headers well over 1MB).
 */
export async function parseGgufMetadata(filepath: string): Promise<GgufMetadata> {
	const READ_SIZES = [1 * 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024];

	for (const readSize of READ_SIZES) {
		const buffer = new Uint8Array(readSize);
		const fd = openSync(filepath, 'r');
		try {
			const bytesRead = readSync(fd, buffer, 0, readSize, 0);
			return parseGgufFromBuffer(buffer.buffer.slice(0, bytesRead));
		} catch (e) {
			// If we ran out of buffer, try a larger read
			if (e instanceof RangeError && readSize < READ_SIZES[READ_SIZES.length - 1]) {
				continue;
			}
			throw e;
		} finally {
			closeSync(fd);
		}
	}

	throw new Error('GGUF header too large to parse');
}

/**
 * Extract quant type string from a filename.
 * Matches: Q4_K_M, IQ3_XXS, F16, F32, BF16, MXFP4, MXFP4_MOE, MXFP6, etc.
 */
export function parseQuantFromFilename(filename: string): string {
	// Known quant patterns: Q/IQ variants, F16/F32/BF16, MXFP variants
	const pattern =
		/[_-]((?:I?Q\d+_(?:[A-Z0-9]+_?)*[A-Z0-9]+|(?:B?F(?:16|32))|(?:MXFP\d+(?:_[A-Z0-9]+)*)))[._-]/i;
	const match = filename.match(pattern);
	if (match) return match[1].toUpperCase();

	// Try at end of name before .gguf
	const endPattern =
		/[_-]((?:I?Q\d+_(?:[A-Z0-9]+_?)*[A-Z0-9]+|(?:B?F(?:16|32))|(?:MXFP\d+(?:_[A-Z0-9]+)*)))\.gguf$/i;
	const endMatch = filename.match(endPattern);
	if (endMatch) return endMatch[1].toUpperCase();

	return 'Unknown';
}

/**
 * Higher-level function that extracts structured model info from a GGUF file.
 */
export async function getModelInfo(filepath: string): Promise<ModelInfo> {
	const gguf = await parseGgufMetadata(filepath);
	const { metadata } = gguf;

	const architecture = (metadata['general.architecture'] as string) ?? 'unknown';
	const arch = architecture;

	const parameterCount =
		metadata['general.parameter_count'] != null
			? Number(metadata['general.parameter_count'])
			: null;

	// Resolve quant type from file_type metadata, fall back to filename
	const fileTypeNum = metadata['general.file_type'];
	let quantType: string;
	if (fileTypeNum != null && FILE_TYPE_MAP[Number(fileTypeNum)]) {
		quantType = FILE_TYPE_MAP[Number(fileTypeNum)];
	} else {
		quantType = parseQuantFromFilename(filepath);
	}

	const contextLength = Number(metadata[`${arch}.context_length`] ?? 0);
	const embeddingLength = Number(metadata[`${arch}.embedding_length`] ?? 0);
	const blockCount = Number(metadata[`${arch}.block_count`] ?? 0);
	const headCount = Number(metadata[`${arch}.attention.head_count`] ?? 0);
	const headCountKV = Number(metadata[`${arch}.attention.head_count_kv`] ?? 0);

	const stat = statSync(filepath);

	return {
		architecture,
		parameterCount,
		quantType,
		contextLength,
		embeddingLength,
		blockCount,
		headCount,
		headCountKV,
		fileSize: stat.size,
		metadata
	};
}
