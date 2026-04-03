const TOOLKIT_CSS = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --color-base: #09090b; --color-elevated: #111113; --color-surface: #18181b;
  --color-surface-hover: #1e1e22; --color-border: #232328; --color-border-active: #3f3f46;
  --color-accent: #22d3ee; --color-accent-dim: #0891b2;
  --color-text-primary: #fafafa; --color-text-secondary: #a1a1aa; --color-text-muted: #52525b;
}
body { background: transparent; color: var(--color-text-primary); font-family: 'DM Sans', system-ui, -apple-system, sans-serif; line-height: 1.5; padding: 0.5rem 0; }
input[type=range] {
  -webkit-appearance: none; appearance: none; width: 100%;
  height: 4px; border-radius: 2px; background: var(--color-surface); outline: none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 12px; height: 12px;
  border-radius: 50%; background: var(--color-accent); cursor: pointer;
}
input[type=range]::-moz-range-thumb {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--color-accent); cursor: pointer; border: none;
}
input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--color-surface); }
button, .btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.375rem 0.75rem; background: transparent; color: var(--color-text-secondary);
  border: 1px solid var(--color-border); border-radius: 0.375rem;
  font-size: 0.875rem; cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
button:hover, .btn:hover { border-color: var(--color-border-active); color: var(--color-text-primary); }
.btn-accent { background: var(--color-accent); color: #09090b; border-color: var(--color-accent); font-weight: 500; }
.btn-accent:hover { filter: brightness(1.1); }
input[type=text], input[type=number], textarea, .input {
  background: var(--color-surface); border: 1px solid var(--color-border);
  color: var(--color-text-primary); padding: 0.375rem 0.75rem;
  border-radius: 0.375rem; font-size: 0.875rem; outline: none;
  transition: border-color 0.15s; font-family: inherit;
}
input[type=text]:focus, input[type=number]:focus, textarea:focus, .input:focus { border-color: var(--color-accent); }
select, .select {
  background: var(--color-surface); border: 1px solid var(--color-border);
  color: var(--color-text-primary); padding: 0.375rem 0.75rem;
  border-radius: 0.375rem; font-size: 0.875rem; outline: none; font-family: inherit;
}
select:focus, .select:focus { border-color: var(--color-accent); }
.flex { display: flex; }
.flex-col { display: flex; flex-direction: column; }
.grid { display: grid; }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.flex-wrap { flex-wrap: wrap; }
.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.m-1 { margin: 0.25rem; }
.m-2 { margin: 0.5rem; }
.m-3 { margin: 0.75rem; }
.m-4 { margin: 1rem; }
.text-center { text-align: center; }
.w-full { width: 100%; }
.h-full { height: 100%; }
.text-sm { font-size: 0.875rem; }
.text-lg { font-size: 1.125rem; }
.text-xl { font-size: 1.25rem; }
.text-muted { color: var(--color-text-muted); }
.text-secondary { color: var(--color-text-secondary); }
.text-accent { color: var(--color-accent); }
.font-bold { font-weight: 700; }
.font-mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
.rounded { border-radius: 0.375rem; }
.border { border: 1px solid var(--color-border); }
.bg-surface { background: var(--color-surface); }
.bg-elevated { background: var(--color-elevated); }
canvas { max-width: 100%; }
h1, h2, h3 { margin-bottom: 0.5rem; color: var(--color-text-primary); }
h1 { font-size: 1.5rem; font-weight: 700; }
h2 { font-size: 1.25rem; font-weight: 600; }
h3 { font-size: 1.125rem; font-weight: 600; }
a { color: var(--color-accent); }
label { color: var(--color-text-secondary); font-size: 0.875rem; }
::selection { background: rgba(34, 211, 238, 0.2); }`;

const TOOLKIT_SCRIPTS = `<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js"><\/script>`;

export function buildSrcdoc(html: string): string {
	const injection = `<style>${TOOLKIT_CSS}</style>\n${TOOLKIT_SCRIPTS}`;
	const headMatch = html.match(/<head(\s[^>]*)?>|<head>/i);
	if (headMatch) {
		const insertPos = (headMatch.index ?? 0) + headMatch[0].length;
		return html.slice(0, insertPos) + injection + html.slice(insertPos);
	}
	return injection + html;
}
