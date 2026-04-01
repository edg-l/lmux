import type { RequestHandler } from './$types';
import { getAllDownloads } from '$lib/server/downloads';

export const GET: RequestHandler = async () => {
	let intervalId: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			intervalId = setInterval(() => {
				try {
					const downloads = getAllDownloads();
					const data: Record<string, unknown> = {};

					for (const [id, progress] of downloads) {
						data[id] = progress;
					}

					const event = `data: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(event));
				} catch {
					clearInterval(intervalId);
					controller.close();
				}
			}, 500);
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
