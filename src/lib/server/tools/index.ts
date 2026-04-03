import { fetchUrl } from './fetch-url';
import { webSearch } from './web-search';
import { readProjectFile } from './read-file';
import { writeProjectFile } from './write-file';
import { editProjectFile } from './edit-file';
import { insertProjectLines } from './insert-lines';
import { listProjectDirectory } from './list-directory';
import { searchProjectFiles } from './search-files';
import { runProjectCommand } from './run-command';
import { startBackgroundProcess } from './start-process';
import { stopBackgroundProcess } from './stop-process';
import { listBackgroundProcesses } from './list-processes';
import { solveMath } from './solve-math';
import { runCode } from './run-code';
import { renderHtml } from './render-html';
import { validateNoteFilename, readNote, writeNote, deleteNote, listNotes } from './memory';

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
	images?: Array<{ name: string; dataUrl: string }>;
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
						description:
							'Regex pattern to search for (e.g. "function main", "TODO", "import.*react")'
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
	},
	{
		type: 'function',
		function: {
			name: 'start_process',
			description:
				'Start a long-running background process (e.g., dev server, file watcher). Returns a process ID. The process runs in the background while you continue working. Use wait_for to wait until the process outputs a specific string (e.g., "listening on port") before returning. Use stop_process to terminate it when done.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The shell command to run' },
					wait_for: {
						type: 'string',
						description:
							'Optional string to wait for in output before returning (e.g., "Serving HTTP"). Waits up to 10 seconds.'
					},
					timeout: {
						type: 'number',
						description:
							'Auto-kill timeout in minutes (default: 30). Process is terminated after this many minutes.'
					}
				},
				required: ['command']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'stop_process',
			description:
				'Stop a background process started with start_process. Returns the remaining output and exit code.',
			parameters: {
				type: 'object',
				properties: {
					id: {
						type: 'string',
						description: 'The process ID returned by start_process (e.g., "bg_1")'
					}
				},
				required: ['id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_processes',
			description:
				'List all background processes for this project. Shows process ID, command, status, and age.',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	}
];

const memoryToolDefinitions: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'memory_read',
			description:
				'Read a note from model memory, or list all notes if no filename given. Filename must end in .md.',
			parameters: {
				type: 'object',
				properties: {
					filename: {
						type: 'string',
						description: 'Name of the note file to read (e.g. MEMORY.md). Omit to list all notes.'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'memory_write',
			description:
				'Write/update a note in model memory. Filename must end in .md. A one-line summary is automatically added to MEMORY.md as an index entry. Do NOT write to MEMORY.md directly unless you want to edit the instructions or index manually.',
			parameters: {
				type: 'object',
				properties: {
					filename: { type: 'string', description: 'Name of the note file (must end in .md)' },
					content: { type: 'string', description: 'Content to write to the note' },
					summary: {
						type: 'string',
						description: 'One-line summary of this note (added to MEMORY.md index automatically)'
					}
				},
				required: ['filename', 'content', 'summary']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'memory_delete',
			description: 'Delete a note from model memory. Filename must end in .md.',
			parameters: {
				type: 'object',
				properties: {
					filename: {
						type: 'string',
						description: 'Name of the note file to delete (must end in .md)'
					}
				},
				required: ['filename']
			}
		}
	}
];

export function getToolDefinitions(
	project?: { id: number; path: string },
	memoryEnabled?: boolean
): ToolDefinition[] {
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
		},
		{
			type: 'function',
			function: {
				name: 'solve_math',
				description:
					"Execute Python code with sympy for symbolic math: equations, calculus, algebra, linear algebra, etc. Print results to stdout. For symbolic results, also print LaTeX with print(latex(expr)) so you can render it in your response. matplotlib is also available for plotting. IMPORTANT: Use plt.savefig('plot.png') to save plots, NEVER plt.show() (there is no display). Images are displayed to the user. Example: \"from sympy import *\\nx = symbols('x')\\nresult = solve(x**2 - 4, x)\\nprint(result)\\nprint(latex(result))\"",
				parameters: {
					type: 'object',
					properties: {
						code: {
							type: 'string',
							description:
								'Python code to execute. sympy is available for import. Print results and optionally print(latex(expr)) for LaTeX output.'
						}
					},
					required: ['code']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'run_code',
				description:
					"Execute a code snippet and return its output. Use this to run Python or bash code for calculations, data processing, testing logic, or verifying answers. The code runs in an isolated sandbox. Pre-installed Python libraries: matplotlib, sympy, numpy. You can generate charts and plots by saving images to the current directory. IMPORTANT: Use plt.savefig('chart.png') to save plots, NEVER plt.show() (there is no display). Supported image formats: png, jpg, webp. Images are displayed to the user.",
				parameters: {
					type: 'object',
					properties: {
						language: {
							type: 'string',
							description: 'The language to execute: python or bash'
						},
						code: { type: 'string', description: 'The code to execute' },
						timeout: {
							type: 'integer',
							description: 'Timeout in seconds (default 30, max 120)'
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
					required: ['language', 'code']
				}
			}
		},
		{
			type: 'function',
			function: {
				name: 'render_html',
				description:
					"Render an interactive HTML page inline in the chat. Do NOT include any <style> tags or CSS - all styling is handled automatically. The page has a dark theme matching the app. All HTML elements (button, input, select, range, h1-h3, label, etc.) are pre-styled. Just write semantic HTML and <script> tags.\n\nWrite content directly in <body> without wrapper divs. Do NOT set background-color, box-shadow, or color on any element.\n\nChart.js is available (regular script): <canvas id='chart'></canvas> <script>new Chart(document.getElementById('chart'), {type:'bar', data:{labels:['A','B'], datasets:[{data:[1,2]}]}})</script>\n\nThree.js is available as ES module. IMPORTANT: use <script type='module'>: <script type='module'>import * as THREE from 'three'; const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(75, w/h, 0.1, 1000); const renderer = new THREE.WebGLRenderer(); document.body.appendChild(renderer.domElement);</script>\n\nNo relative URLs work in the sandbox.",
				parameters: {
					type: 'object',
					properties: {
						html: {
							type: 'string',
							description:
								'Complete HTML document to render. Include all CSS in <style> and JS in <script> tags.'
						}
					},
					required: ['html']
				}
			}
		}
	];

	if (project) {
		tools.push(...codingToolDefinitions);
	}

	if (memoryEnabled) {
		tools.push(...memoryToolDefinitions);
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
		case 'start_process': {
			if (!project) throw new Error('start_process requires a project context');
			return startBackgroundProcess(
				args as { command: string; wait_for?: string; timeout?: number },
				project.path,
				project.id
			);
		}
		case 'stop_process': {
			if (!project) throw new Error('stop_process requires a project context');
			return stopBackgroundProcess(args as { id: string });
		}
		case 'list_processes': {
			if (!project) throw new Error('list_processes requires a project context');
			return listBackgroundProcesses(project.id);
		}
		case 'solve_math': {
			const { output, images } = await solveMath(args as { code: string });
			return { result: output, images };
		}
		case 'run_code': {
			const { output, images } = await runCode(
				args as {
					language: string;
					code: string;
					timeout?: number;
					offset?: number;
					max_length?: number;
				}
			);
			return { result: output, images };
		}
		case 'render_html': {
			const res = renderHtml(args as { html: string });
			return { result: res.result, error: res.error };
		}
		case 'memory_read': {
			const filename = args.filename as string | undefined;
			if (filename) {
				const validationError = validateNoteFilename(filename);
				if (validationError) return { result: validationError, error: true };
				try {
					const content = readNote(filename);
					return { result: content };
				} catch (e) {
					return { result: e instanceof Error ? e.message : 'Failed to read note.', error: true };
				}
			}
			const notes = listNotes();
			if (notes.length === 0) return { result: 'No notes found.' };
			return { result: 'Notes:\n' + notes.map((n) => `- ${n}`).join('\n') };
		}
		case 'memory_write': {
			const filename = args.filename as string;
			const content = args.content as string;
			const summary = args.summary as string | undefined;
			if (content == null || typeof content !== 'string') {
				return { result: 'Error: content is required and must be a string.', error: true };
			}
			if (content.length > 64 * 1024) {
				return { result: 'Error: content too large (max 64KB).', error: true };
			}
			const validationError = validateNoteFilename(filename);
			if (validationError) return { result: validationError, error: true };
			try {
				writeNote(filename, content, summary);
				return { result: `Wrote '${filename}'.` };
			} catch (e) {
				return { result: e instanceof Error ? e.message : 'Failed to write note.', error: true };
			}
		}
		case 'memory_delete': {
			const filename = args.filename as string;
			const validationError = validateNoteFilename(filename);
			if (validationError) return { result: validationError, error: true };
			const result = deleteNote(filename);
			return { result };
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}
