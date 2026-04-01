import type { RequestHandler } from './$types';
import { getServerState } from '$lib/server/llama';

export const GET: RequestHandler = async () => {
	let intervalId: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			// Send current state immediately
			const initial = getServerState();
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`));

			intervalId = setInterval(() => {
				try {
					const state = getServerState();
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
				} catch {
					clearInterval(intervalId);
					controller.close();
				}
			}, 1000);
		},
		cancel() {
			clearInterval(intervalId);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
