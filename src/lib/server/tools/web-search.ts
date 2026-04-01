import { getSetting } from '../settings';

interface SearxResult {
	title: string;
	url: string;
	content: string;
}

interface SearxResponse {
	results: SearxResult[];
}

export async function webSearch(args: { query: string }): Promise<string> {
	const searxngUrl = getSetting('searxng_url');

	if (!searxngUrl) {
		return 'Web search not configured. Set a SearXNG URL in settings.';
	}

	try {
		const url = `${searxngUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(args.query)}&format=json`;
		const res = await fetch(url, {
			signal: AbortSignal.timeout(10_000)
		});

		if (!res.ok) {
			return `Search error: HTTP ${res.status} ${res.statusText}`;
		}

		const data = (await res.json()) as SearxResponse;
		const results = Array.isArray(data?.results) ? data.results : [];
		const top = results.slice(0, 5);

		if (top.length === 0) {
			return 'No search results found.';
		}

		return top.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.content}`).join('\n\n');
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return `Search error: ${message}`;
	}
}
