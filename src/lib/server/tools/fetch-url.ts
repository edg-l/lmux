const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const DEFAULT_MAX_LENGTH = 8000;

const cache = new Map<string, { text: string; expiresAt: number }>();

const MAX_CACHE_ENTRIES = 100;

function isPrivateUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		if (!['http:', 'https:'].includes(u.protocol)) return true;
		const h = u.hostname;
		return (
			h === 'localhost' ||
			h.startsWith('127.') ||
			h.startsWith('10.') ||
			h.startsWith('192.168.') ||
			h.startsWith('169.254.') ||
			h.startsWith('100.64.') ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
			h.startsWith('0.') ||
			h === '0.0.0.0' ||
			h === '::1' ||
			h === '[::1]' ||
			h.startsWith('fc') ||
			h.startsWith('fd') ||
			h.startsWith('fe80')
		);
	} catch {
		return true;
	}
}

function stripHtml(html: string): string {
	let text = html;
	// Remove script and style elements
	text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
	text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
	// Strip all HTML tags
	text = text.replace(/<[^>]+>/g, ' ');
	// Collapse whitespace
	text = text.replace(/\s+/g, ' ').trim();
	return text;
}

async function fetchAndCache(url: string): Promise<string> {
	const cached = cache.get(url);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.text;
	}

	const res = await fetch(url, {
		signal: AbortSignal.timeout(10_000)
	});

	if (!res.ok) {
		throw new Error(`HTTP ${res.status} ${res.statusText}`);
	}

	const contentType = res.headers.get('content-type') ?? '';
	if (
		!contentType.includes('text/') &&
		!contentType.includes('application/json') &&
		!contentType.includes('application/xml')
	) {
		throw new Error(`Unsupported content type: ${contentType}`);
	}

	const text = stripHtml(await res.text());
	cache.set(url, { text, expiresAt: Date.now() + CACHE_TTL_MS });

	// Evict expired entries, then oldest if over limit
	for (const [key, entry] of cache) {
		if (entry.expiresAt <= Date.now()) cache.delete(key);
	}
	while (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value!;
		cache.delete(oldest);
	}

	return text;
}

export async function fetchUrl(args: {
	url: string;
	max_length?: number;
	offset?: number;
}): Promise<string> {
	if (isPrivateUrl(args.url)) {
		return 'Error: private/local URLs are not allowed';
	}

	try {
		const text = await fetchAndCache(args.url);
		const offset = args.offset ?? 0;
		const maxLength = args.max_length ?? DEFAULT_MAX_LENGTH;
		const slice = text.slice(offset, offset + maxLength);

		if (slice.length === 0 && text.length > 0) {
			return `No content at offset ${offset}. Total length: ${text.length} characters.`;
		}

		const hasMore = offset + maxLength < text.length;
		const header = `[${text.length} chars total, showing ${offset}-${offset + slice.length}${hasMore ? ', more available' : ''}]\n\n`;
		return header + slice;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return `Error fetching URL: ${message}`;
	}
}
