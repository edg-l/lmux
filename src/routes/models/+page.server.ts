import type { PageServerLoad } from './$types';
import { getAllModels } from '$lib/server/models';

export const load: PageServerLoad = async () => {
	return {
		models: getAllModels()
	};
};
