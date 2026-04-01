import type { RequestHandler } from './$types';
import { getServerState } from '$lib/server/llama';

export const POST: RequestHandler = async ({ request }) => {
	const state = getServerState();
	if (state.status !== 'ready') {
		return new Response(JSON.stringify({ error: 'No server running' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const body = (await request.json()) as {
		messages: Array<{ role: string; content: string }>;
		sampling?: {
			temperature?: number;
			top_p?: number;
			top_k?: number;
			min_p?: number;
			repeat_penalty?: number;
		};
	};

	if (!body.messages || !Array.isArray(body.messages)) {
		return new Response(JSON.stringify({ error: 'Missing messages array' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const llamaRes = await fetch(`http://localhost:${state.port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages: body.messages,
				stream: true,
				stream_options: { include_usage: true },
				...(body.sampling && {
					temperature: body.sampling.temperature,
					top_p: body.sampling.top_p,
					top_k: body.sampling.top_k,
					min_p: body.sampling.min_p,
					repeat_penalty: body.sampling.repeat_penalty
				})
			})
		});

		if (!llamaRes.ok || !llamaRes.body) {
			const text = await llamaRes.text();
			return new Response(JSON.stringify({ error: `llama-server error: ${text}` }), {
				status: llamaRes.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Pipe the SSE stream from llama-server to the client
		return new Response(llamaRes.body, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to connect to llama-server';
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
