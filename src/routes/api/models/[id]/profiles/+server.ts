import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfiles, createProfile, generateDefaultProfile } from '$lib/server/models';
import type { ProfileInput } from '$lib/server/models';

export const GET: RequestHandler = async ({ params }) => {
	const modelId = parseInt(params.id);
	if (isNaN(modelId)) return json({ error: 'Invalid id' }, { status: 400 });
	const profiles = getProfiles(modelId);
	return json(profiles);
};

export const POST: RequestHandler = async ({ params, request, url }) => {
	const modelId = parseInt(params.id);
	if (isNaN(modelId)) return json({ error: 'Invalid id' }, { status: 400 });

	// Support generating default profile
	const generateDefault = url.searchParams.get('default');
	if (generateDefault === 'true') {
		try {
			const defaultProfile = await generateDefaultProfile(modelId);
			const id = createProfile(modelId, defaultProfile);
			return json({ id, ...defaultProfile }, { status: 201 });
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to generate default profile';
			return json({ error: message }, { status: 500 });
		}
	}

	const body = (await request.json()) as ProfileInput;
	if (!body.name) {
		return json({ error: 'Missing profile name' }, { status: 400 });
	}

	const id = createProfile(modelId, body);
	return json({ id }, { status: 201 });
};
