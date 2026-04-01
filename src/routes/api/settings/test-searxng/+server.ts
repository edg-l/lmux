import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { url: string };
	const url = body.url?.trim().replace(/\/$/, '');

	if (!url) {
		return json({ ok: false, error: 'No URL provided' }, { status: 400 });
	}

	try {
		const res = await fetch(`${url}/search?q=test&format=json`, {
			signal: AbortSignal.timeout(5000)
		});

		if (!res.ok) {
			return json({ ok: false, error: `HTTP ${res.status} ${res.statusText}` });
		}

		const data = await res.json();
		if (!Array.isArray(data?.results)) {
			return json({ ok: false, error: 'Invalid response: missing results array' });
		}

		return json({ ok: true, resultCount: data.results.length });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Connection failed';
		return json({ ok: false, error: message });
	}
};
