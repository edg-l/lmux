import type { PageServerLoad } from './$types';
import { fetchTrendingModels } from '$lib/server/huggingface';

export const load: PageServerLoad = async () => {
	try {
		const trending = await fetchTrendingModels(20);
		return { trending };
	} catch {
		return { trending: [] };
	}
};
