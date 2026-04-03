import { describe, it, expect } from 'bun:test';
import { executePlannerTool, PLANNER_TOOL_DEFINITIONS } from './index';

describe('PLANNER_TOOL_DEFINITIONS', () => {
	it('contains exactly 3 tool definitions', () => {
		expect(PLANNER_TOOL_DEFINITIONS).toHaveLength(3);
	});

	it('contains only read_file, search_files, and list_directory', () => {
		const names = PLANNER_TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toContain('read_file');
		expect(names).toContain('search_files');
		expect(names).toContain('list_directory');
	});

	it('does not contain write or command tools', () => {
		const names = PLANNER_TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).not.toContain('write_file');
		expect(names).not.toContain('edit_file');
		expect(names).not.toContain('run_command');
	});
});

describe('executePlannerTool', () => {
	it('rejects tools not in the allowlist', async () => {
		const result = await executePlannerTool('write_file', { path: 'x', content: 'y' }, '/tmp');
		expect(result).toBe('Error: Tool not available during planning');
	});

	it('rejects run_command', async () => {
		const result = await executePlannerTool('run_command', { command: 'ls' }, '/tmp');
		expect(result).toBe('Error: Tool not available during planning');
	});

	it('rejects edit_file', async () => {
		const result = await executePlannerTool('edit_file', {}, '/tmp');
		expect(result).toBe('Error: Tool not available during planning');
	});

	it('rejects unknown tools', async () => {
		const result = await executePlannerTool('unknown_tool', {}, '/tmp');
		expect(result).toBe('Error: Tool not available during planning');
	});
});
