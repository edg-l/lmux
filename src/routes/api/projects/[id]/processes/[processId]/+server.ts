import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopTrackedProcess } from '$lib/server/process-registry';

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { output, exitCode } = await stopTrackedProcess(params.processId);
		return json({ ok: true, output, exitCode });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 404 });
	}
};
