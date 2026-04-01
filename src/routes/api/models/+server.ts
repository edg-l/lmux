import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllModels, scanModels } from '$lib/server/models';

export const GET: RequestHandler = async ({ url }) => {
	const scan = url.searchParams.get('scan');
	if (scan === 'true') {
		const added = await scanModels();
		return json({ added, models: getAllModels() });
	}

	return json(getAllModels());
};
