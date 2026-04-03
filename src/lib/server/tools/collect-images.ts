import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB budget (raw bytes)

function getMimeType(ext: string): string {
	switch (ext) {
		case '.png':
			return 'image/png';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.gif':
			return 'image/gif';
		case '.webp':
			return 'image/webp';
		default:
			return 'application/octet-stream';
	}
}

export function collectImages(tempDir: string): Array<{ name: string; dataUrl: string }> {
	try {
		const entries = readdirSync(tempDir);
		const images: Array<{ name: string; dataUrl: string }> = [];
		let cumulativeBytes = 0;

		for (const entry of entries) {
			const ext = entry.substring(entry.lastIndexOf('.')).toLowerCase();
			if (!IMAGE_EXTENSIONS.includes(ext)) continue;

			const filePath = join(tempDir, entry);
			try {
				if (!statSync(filePath).isFile()) continue;
			} catch {
				continue;
			}
			const data = readFileSync(filePath);

			if (cumulativeBytes + data.length > MAX_TOTAL_BYTES) continue;
			cumulativeBytes += data.length;

			const mime = getMimeType(ext);
			const base64 = data.toString('base64');
			images.push({ name: entry, dataUrl: `data:${mime};base64,${base64}` });
		}

		return images;
	} catch {
		return [];
	}
}
