export interface DangerMatch {
	segment: string;
	label: string;
	startIndex: number;
	endIndex: number;
}

interface DangerRule {
	test: (segment: string) => boolean;
	label: string;
}

const dangerRules: DangerRule[] = [
	{
		test: (s) => {
			if (!/^rm\s/.test(s)) return false;
			// Check for -rf, -fr, or -r/-f flags in any combination
			const parts = s.split(/\s+/);
			let hasR = false;
			for (const p of parts.slice(1)) {
				if (p.startsWith('-') && !p.startsWith('--')) {
					if (p.includes('r')) hasR = true;
				}
			}
			return hasR;
		},
		label: 'rm -rf'
	},
	{
		test: (s) => /^git\s+checkout\s+--/.test(s),
		label: 'git checkout --'
	},
	{
		test: (s) => /^git\s+reset\s+--hard/.test(s),
		label: 'git reset --hard'
	},
	{
		test: (s) => {
			if (!/^git\s+clean\b/.test(s)) return false;
			const parts = s.split(/\s+/);
			return parts.some((p) => p.startsWith('-') && p.includes('f') && !p.startsWith('--'));
		},
		label: 'git clean -f'
	},
	{
		test: (s) => {
			if (!/^git\s+push\b/.test(s)) return false;
			const parts = s.split(/\s+/);
			return parts.some(
				(p) => p === '--force' || (p.startsWith('-') && !p.startsWith('--') && p.includes('f'))
			);
		},
		label: 'git push --force'
	},
	{
		test: (s) => {
			if (!/^git\s+branch\b/.test(s)) return false;
			const parts = s.split(/\s+/);
			return parts.some(
				(p) => p === '-D' || (p.startsWith('-') && !p.startsWith('--') && p.includes('D'))
			);
		},
		label: 'git branch -D'
	},
	{
		test: (s) => /^chmod\s+.*\b777\b/.test(s),
		label: 'chmod 777'
	},
	{
		test: (s) => /^mkfs\b/.test(s),
		label: 'mkfs'
	},
	{
		test: (s) => /^dd\s/.test(s) && /\bif=/.test(s),
		label: 'dd'
	},
	{
		test: (s) => /^truncate\b/.test(s),
		label: 'truncate'
	},
	{
		test: (s) => /^shred\b/.test(s),
		label: 'shred'
	},
	{
		test: (s) => /^eval\b/.test(s),
		label: 'eval'
	},
	{
		test: (s) => /^exec\b/.test(s),
		label: 'exec'
	}
];

/**
 * Split a command on shell operators (&&, ||, ;, |) preserving original positions,
 * then check each segment against dangerous patterns.
 */
export function detectDangerousPatterns(command: string): DangerMatch[] {
	const matches: DangerMatch[] = [];

	// Split on &&, ||, ;, | while tracking positions
	// We use a regex to find the separators and derive segments from the gaps
	const separatorRegex = /&&|\|\||[;|]/g;
	const segments: { text: string; start: number; end: number }[] = [];

	let lastEnd = 0;
	let match: RegExpExecArray | null;
	while ((match = separatorRegex.exec(command)) !== null) {
		segments.push({
			text: command.slice(lastEnd, match.index),
			start: lastEnd,
			end: match.index
		});
		lastEnd = match.index + match[0].length;
	}
	// Final segment
	segments.push({
		text: command.slice(lastEnd),
		start: lastEnd,
		end: command.length
	});

	for (const seg of segments) {
		const trimmed = seg.text.trim();
		if (!trimmed) continue;

		for (const rule of dangerRules) {
			if (rule.test(trimmed)) {
				matches.push({
					segment: trimmed,
					label: rule.label,
					startIndex: seg.start,
					endIndex: seg.end
				});
				break; // one label per segment
			}
		}
	}

	// Full-command injection patterns detected on the raw command string
	const fullCommandPatterns: { regex: RegExp; label: string }[] = [
		{
			// Matches > or >> redirects but NOT 2>&1 or >&2 forms
			// Negative lookbehind excludes digit& prefix; negative lookahead excludes >&
			regex: /(?<![0-9&])>{1,2}(?!&)\s*\S/g,
			label: 'output redirect (>)'
		},
		{
			// Matches backtick-enclosed content
			regex: /`[^`]*`/g,
			label: 'backtick substitution'
		},
		{
			regex: /\$\(/g,
			label: 'subshell $(...)'
		}
	];

	for (const { regex, label } of fullCommandPatterns) {
		let m: RegExpExecArray | null;
		while ((m = regex.exec(command)) !== null) {
			matches.push({
				segment: m[0],
				label,
				startIndex: m.index,
				endIndex: m.index + m[0].length
			});
		}
	}

	return matches;
}
