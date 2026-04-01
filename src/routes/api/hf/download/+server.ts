import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startDownload, cancelDownload } from '$lib/server/downloads';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { repoId, filename } = body as { repoId?: string; filename?: string };

	if (!repoId || !filename) {
		return json({ error: 'Missing repoId or filename' }, { status: 400 });
	}

	try {
		const downloadId = await startDownload(repoId, filename);
		return json({ downloadId });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to start download';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return json({ error: 'Missing download id' }, { status: 400 });
	}

	cancelDownload(id);
	return json({ ok: true });
};
