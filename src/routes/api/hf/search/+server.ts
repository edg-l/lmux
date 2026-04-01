import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchModels } from '$lib/server/huggingface';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q');
	if (!query) {
		return json({ error: 'Missing query parameter "q"' }, { status: 400 });
	}

	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20') || 20, 100);

	try {
		const results = await searchModels(query, limit);
		return json(results);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Search failed';
		return json({ error: message }, { status: 502 });
	}
};
