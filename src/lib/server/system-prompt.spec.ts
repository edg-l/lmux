import { describe, it, expect } from 'bun:test';
import { PLANNING_SYSTEM_PROMPT, buildPlanInjectedPrompt } from './system-prompt';

describe('PLANNING_SYSTEM_PROMPT', () => {
	it('contains instruction to produce only numbered steps', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('numbered step-by-step plan');
	});

	it('contains instruction for concise steps', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('ONE concise sentence');
	});

	it('contains atomic step instruction', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('atomic');
	});

	it('contains verify-and-repair instruction', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('verify-and-repair');
	});

	it('instructs not to write code', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('no code snippets');
	});

	it('lists available tool names', () => {
		expect(PLANNING_SYSTEM_PROMPT).toContain('read_file');
		expect(PLANNING_SYSTEM_PROMPT).toContain('write_file');
		expect(PLANNING_SYSTEM_PROMPT).toContain('edit_file');
		expect(PLANNING_SYSTEM_PROMPT).toContain('insert_lines');
		expect(PLANNING_SYSTEM_PROMPT).toContain('list_directory');
		expect(PLANNING_SYSTEM_PROMPT).toContain('search_files');
		expect(PLANNING_SYSTEM_PROMPT).toContain('run_command');
	});
});

describe('buildPlanInjectedPrompt', () => {
	it('appends plan text to the coding prompt', () => {
		const codingPrompt = 'You are a coding assistant.';
		const planText = '1. Read the file\n2. Edit it';
		const result = buildPlanInjectedPrompt(codingPrompt, planText);

		expect(result).toContain(codingPrompt);
		expect(result).toContain('## Your Plan');
		expect(result).toContain('Follow this plan step by step');
		expect(result).toContain(planText);
	});

	it('returns the coding prompt unchanged when plan is empty', () => {
		const codingPrompt = 'You are a coding assistant.';
		const result = buildPlanInjectedPrompt(codingPrompt, '');
		expect(result).toBe(codingPrompt);
	});

	it('returns the coding prompt unchanged when plan is whitespace only', () => {
		const codingPrompt = 'You are a coding assistant.';
		const result = buildPlanInjectedPrompt(codingPrompt, '   \n  ');
		expect(result).toBe(codingPrompt);
	});

	it('places the plan section after the coding prompt', () => {
		const codingPrompt = 'Base prompt here.';
		const planText = '1. Do something';
		const result = buildPlanInjectedPrompt(codingPrompt, planText);

		const baseIdx = result.indexOf(codingPrompt);
		const planIdx = result.indexOf('## Your Plan');
		expect(baseIdx).toBeLessThan(planIdx);
	});
});
