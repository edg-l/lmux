import { describe, it, expect } from 'bun:test';
import { validatePlan } from './planning';

describe('validatePlan', () => {
	it('returns plan unchanged when step count is adequate', () => {
		const plan = '1. Read file\n2. Edit it\n3. Add tests\n4. Fix imports\n5. Run build\n6. Verify';
		const result = validatePlan(plan, 150);
		expect(result).toBe(plan);
	});

	it('prepends warning when plan has fewer than 5 steps and user message is long', () => {
		const plan = '1. Read file\n2. Edit it\n3. Run build';
		const result = validatePlan(plan, 150);
		expect(result).toContain('[Warning:');
		expect(result).toContain('only 3 steps');
		expect(result).toContain(plan);
	});

	it('does not warn when user message is short even if plan has few steps', () => {
		const plan = '1. Read file\n2. Edit it';
		const result = validatePlan(plan, 50);
		expect(result).toBe(plan);
	});

	it('does not warn when plan has exactly 5 steps', () => {
		const plan = '1. A\n2. B\n3. C\n4. D\n5. E';
		const result = validatePlan(plan, 200);
		expect(result).toBe(plan);
	});

	it('counts only lines starting with digits followed by a period', () => {
		const plan = 'Some preamble\n1. Step one\n- bullet point\n2. Step two\n3. Step three';
		const result = validatePlan(plan, 200);
		expect(result).toContain('[Warning:');
		expect(result).toContain('only 3 steps');
	});
});
