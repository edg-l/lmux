import { fetchUrl } from './fetch-url';
import { webSearch } from './web-search';

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, { type: string; description: string }>;
			required: string[];
		};
	};
}

export function getToolDefinitions(): ToolDefinition[] {
	return [
		{
			type: 'function',
			function: {
				name: 'fetch_url',
				description:
					'Fetch a URL and return its text content. Supports pagination via offset/max_length for long pages.',
				parameters: {
					type: 'object',
					properties: {
						url: { type: 'string', description: 'The URL to fetch' },
						offset: {
							type: 'integer',
							description: 'Character offset to start reading from (default 0)'
						},
						max_length: {
							type: 'integer',
							description: 'Maximum characters to return (default 8000)'
						}
					},
					required: ['url']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'web_search',
				description: 'Search the web and return results',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The search query' }
					},
					required: ['query']
				}
			}
		}
	];
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
	switch (name) {
		case 'fetch_url':
			return fetchUrl(args as { url: string; max_length?: number; offset?: number });
		case 'web_search':
			return webSearch(args as { query: string });
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}
