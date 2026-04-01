import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRepoFiles } from '$lib/server/huggingface';

export const GET: RequestHandler = async ({ params }) => {
	const repoId = `${params.owner}/${params.repo}`;

	try {
		const files = await listRepoFiles(repoId);
		return json(files);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to list files';
		return json({ error: message }, { status: 502 });
	}
};
