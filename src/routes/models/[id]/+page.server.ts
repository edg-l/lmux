import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getModel, getProfiles } from '$lib/server/models';

export const load: PageServerLoad = async ({ params }) => {
	const id = parseInt(params.id);
	const model = getModel(id);

	if (!model) {
		error(404, 'Model not found');
	}

	const profiles = getProfiles(id);

	return { model, profiles };
};
