import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isLandlockAvailable } from '$lib/server/sandbox';

export const GET: RequestHandler = async () => {
	return json({ available: isLandlockAvailable() });
};
