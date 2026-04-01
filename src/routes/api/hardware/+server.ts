import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHardwareProfile, refreshHardwareProfile } from '$lib/server/hardware';

export const GET: RequestHandler = async () => {
	const profile = getHardwareProfile();
	return json(profile);
};

export const POST: RequestHandler = async ({ url }) => {
	const refresh = url.searchParams.get('refresh');
	if (refresh === 'true') {
		const profile = refreshHardwareProfile();
		return json(profile);
	}
	const profile = getHardwareProfile();
	return json(profile);
};
