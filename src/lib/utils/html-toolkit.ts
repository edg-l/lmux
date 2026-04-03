const TOOLKIT_CSS = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --accent: #06b6d4; --bg: #0f172a; --fg: #e2e8f0; --border: #334155; --surface: #1e293b; }
body { background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; padding: 1rem; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; background: var(--accent); color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; transition: filter 0.15s; }
.btn:hover { filter: brightness(1.15); }
.slider { width: 100%; accent-color: var(--accent); }
.input { background: var(--surface); border: 1px solid var(--border); color: var(--fg); padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: 0.875rem; outline: none; transition: border-color 0.15s; }
.input:focus { border-color: var(--accent); }
.select { background: var(--surface); border: 1px solid var(--border); color: var(--fg); padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: 0.875rem; outline: none; transition: border-color 0.15s; }
.select:focus { border-color: var(--accent); }
.flex { display: flex; }
.flex-col { display: flex; flex-direction: column; }
.grid { display: grid; }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
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
.font-bold { font-weight: 700; }
canvas { max-width: 100%; }
h1, h2, h3 { margin-bottom: 0.5rem; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }`;

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
