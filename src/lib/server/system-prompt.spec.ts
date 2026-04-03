import { describe, it, expect } from 'bun:test';
import { buildPlanningSystemPrompt, buildPlanInjectedPrompt } from './system-prompt';

describe('buildPlanningSystemPrompt', () => {
	it('contains instruction to produce numbered steps', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('Numbered steps');
	});

	it('contains instruction for atomic steps', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('ONE atomic action');
	});

	it('contains atomic step instruction', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('atomic');
	});

	it('contains verify-and-repair instruction', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('verify-and-repair');
	});

	it('requires gap analysis section', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('Gap Analysis');
	});

	it('instructs to explore codebase before planning', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).toContain('MUST be tool calls');
	});

	it('appends retrieval context when provided', () => {
		const prompt = buildPlanningSystemPrompt('## Some Context\nfile content here');
		expect(prompt).toContain('## Codebase Context');
		expect(prompt).toContain('file content here');
	});

	it('does not include codebase context section when retrieval is empty', () => {
		const prompt = buildPlanningSystemPrompt('');
		expect(prompt).not.toContain('## Codebase Context');
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
