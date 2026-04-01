import { json } from '@sveltejs/kit';
import { unlinkSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { getModel, deleteModel, getProfiles } from '$lib/server/models';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const model = getModel(id);
	if (!model) {
		return json({ error: 'Model not found' }, { status: 404 });
	}

	const profiles = getProfiles(id);
	return json({ ...model, profiles });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });
	const filepath = deleteModel(id);

	if (!filepath) {
		return json({ error: 'Model not found' }, { status: 404 });
	}

	// Delete file from disk
	try {
		unlinkSync(filepath);
	} catch {
		// File may already be gone
	}

	return json({ ok: true });
};
