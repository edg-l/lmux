import { fetchUrl } from './fetch-url';
import { webSearch } from './web-search';
import { readProjectFile } from './read-file';
import { writeProjectFile } from './write-file';
import { editProjectFile } from './edit-file';
import { insertProjectLines } from './insert-lines';
import { listProjectDirectory } from './list-directory';
import { searchProjectFiles } from './search-files';
import { runProjectCommand } from './run-command';

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

export interface ToolResult {
	result: string;
	error?: boolean;
	fileChanged?: { path: string; operation: 'created' | 'modified' };
	blockedPaths?: string[];
}

const codingToolDefinitions: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'read_file',
			description:
				'Read a file from the project. Returns line-numbered content. For large files, use offset and limit to paginate (e.g. offset=200, limit=200 for the next page). The response header shows [lines X-Y of TOTAL] so you know if more content remains. You MUST read a file before editing it.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path to the file' },
					offset: {
						type: 'integer',
						description: 'Line offset to start reading from (0-indexed, default 0)'
					},
					limit: {
						type: 'integer',
						description: 'Maximum number of lines to return (default 200)'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description:
				'Creates a new file or overwrites an existing file entirely. Only use for new files or complete rewrites. For modifying existing files, use edit_file instead.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path to the file' },
					content: { type: 'string', description: 'The content to write' }
				},
				required: ['path', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description:
				'Edit a file by replacing occurrences of a string. More precise than write_file for modifications. Returns a diff showing the change.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path to the file' },
					old_string: { type: 'string', description: 'The string to find and replace' },
					new_string: { type: 'string', description: 'The replacement string' },
					replace_all: {
						type: 'boolean',
						description: 'Replace all occurrences instead of requiring exactly one'
					}
				},
				required: ['path', 'old_string', 'new_string']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'insert_lines',
			description:
				'Insert text at a specific line number in a file without replacing existing content. Use read_file first to find the correct line number. Line numbers match the output of read_file.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path to the file' },
					line: {
						type: 'integer',
						description: 'Line number to insert before (0 = beginning of file)'
					},
					content: { type: 'string', description: 'The text to insert' }
				},
				required: ['path', 'line', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_directory',
			description:
				'List files and directories in a tree format, respecting .gitignore. Use this first to understand the project structure before reading or editing files. Increase depth to explore deeper subdirectories.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Relative path to list (default: project root)'
					},
					depth: {
						type: 'integer',
						description: 'Maximum depth to recurse (default 2, max 5)'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_files',
			description:
				'Search for a regex pattern across project files using ripgrep. Returns matching lines with file paths and line numbers (max 50 results). Use this to find where functions, classes, variables, or strings are defined or used. Use the glob parameter to narrow results to specific file types.',
			parameters: {
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						description: 'Regex pattern to search for (e.g. "function main", "TODO", "import.*react")'
					},
					glob: {
						type: 'string',
						description: 'Glob pattern to filter files (e.g. "*.ts", "*.py", "src/**/*.js")'
					},
					path: {
						type: 'string',
						description: 'Relative path to search within (default: project root)'
					}
				},
				required: ['pattern']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_command',
			description:
				'Run a shell command in the project directory. The command runs in a sandbox with read-only access to the system and read-write access to the project. Output is truncated to max_length; use offset to read more if the output says "[truncated]". Use this to build, test, lint, and verify changes.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The shell command to run' },
					timeout: {
						type: 'integer',
						description: 'Timeout in seconds (default 30, max 300)'
					},
					offset: {
						type: 'integer',
						description:
							'Character offset to start reading output from. Use when previous output was truncated.'
					},
					max_length: {
						type: 'integer',
						description: 'Maximum output length in characters (default 8192)'
					}
				},
				required: ['command']
			}
		}
	}
];

export function getToolDefinitions(project?: { id: number; path: string }): ToolDefinition[] {
	const tools: ToolDefinition[] = [
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

	if (project) {
		tools.push(...codingToolDefinitions);
	}

	return tools;
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	project?: { id: number; path: string }
): Promise<ToolResult> {
	switch (name) {
		case 'fetch_url': {
			const result = await fetchUrl(args as { url: string; max_length?: number; offset?: number });
			return { result };
		}
		case 'web_search': {
			const result = await webSearch(args as { query: string });
			return { result };
		}
		case 'read_file': {
			if (!project) throw new Error('read_file requires a project context');
			const result = await readProjectFile(
				args as { path: string; offset?: number; limit?: number },
				project.path
			);
			return { result };
		}
		case 'write_file': {
			if (!project) throw new Error('write_file requires a project context');
			return writeProjectFile(args as { path: string; content: string }, project.path);
		}
		case 'edit_file': {
			if (!project) throw new Error('edit_file requires a project context');
			return editProjectFile(
				args as {
					path: string;
					old_string: string;
					new_string: string;
					replace_all?: boolean;
				},
				project.path
			);
		}
		case 'insert_lines': {
			if (!project) throw new Error('insert_lines requires a project context');
			return insertProjectLines(
				args as { path: string; line: number; content: string },
				project.path
			);
		}
		case 'list_directory': {
			if (!project) throw new Error('list_directory requires a project context');
			const result = await listProjectDirectory(
				args as { path?: string; depth?: number },
				project.path
			);
			return { result };
		}
		case 'search_files': {
			if (!project) throw new Error('search_files requires a project context');
			const result = await searchProjectFiles(
				args as { pattern: string; glob?: string; path?: string },
				project.path
			);
			return { result };
		}
		case 'run_command': {
			if (!project) throw new Error('run_command requires a project context');
			const { output, blockedPaths } = await runProjectCommand(
				args as { command: string; timeout?: number; offset?: number; max_length?: number },
				project.path
			);
			return { result: output, blockedPaths };
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}
