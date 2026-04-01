import type { PageServerLoad } from './$types';
import { getAllModels } from '$lib/server/models';
import { getHardwareProfile } from '$lib/server/hardware';

export const load: PageServerLoad = async () => {
	const models = getAllModels();
	const hardware = getHardwareProfile();
	return { models, hardware };
};
