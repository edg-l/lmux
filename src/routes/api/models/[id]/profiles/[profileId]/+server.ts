import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfile, updateProfile, deleteProfile } from '$lib/server/models';
import type { ProfileInput } from '$lib/server/models';

export const PUT: RequestHandler = async ({ params, request }) => {
	const profileId = parseInt(params.profileId);
	if (isNaN(profileId)) return json({ error: 'Invalid id' }, { status: 400 });
	const existing = getProfile(profileId);
	if (!existing) {
		return json({ error: 'Profile not found' }, { status: 404 });
	}

	const body = (await request.json()) as ProfileInput;
	if (!body.name) {
		return json({ error: 'Missing profile name' }, { status: 400 });
	}

	updateProfile(profileId, body);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const profileId = parseInt(params.profileId);
	if (isNaN(profileId)) return json({ error: 'Invalid id' }, { status: 400 });
	deleteProfile(profileId);
	return json({ ok: true });
};
