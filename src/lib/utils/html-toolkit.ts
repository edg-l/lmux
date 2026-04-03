// Injected AFTER the model's HTML so our styles always win.
// Styles target raw HTML elements so the model just writes semantic markup.
const TOOLKIT_CSS = `*, *::before, *::after { box-sizing: border-box !important; }
html, body { background: transparent !important; color: #fafafa !important; font-family: 'DM Sans', system-ui, -apple-system, sans-serif !important; line-height: 1.5 !important; margin: 0 !important; padding: 0 !important; overflow-x: hidden !important; }
body { padding: 0.5rem 0 !important; }
body > div { box-shadow: none !important; }
h1, h2, h3, h4, h5, h6 { color: #fafafa !important; margin-bottom: 0.5rem; }
h1 { font-size: 1.5rem; font-weight: 700; }
h2 { font-size: 1.25rem; font-weight: 600; }
h3 { font-size: 1.125rem; font-weight: 600; }
p { margin-bottom: 0.5rem; }
a { color: #22d3ee; }
label { color: #a1a1aa; font-size: 0.875rem; display: block; margin-bottom: 0.25rem; }
button {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.375rem 0.75rem; background: transparent !important; color: #a1a1aa !important;
  border: 1px solid #232328 !important; border-radius: 0.375rem; font-size: 0.875rem;
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
button:hover { border-color: #3f3f46 !important; color: #fafafa !important; }
input[type=range] {
  -webkit-appearance: none; appearance: none; width: 100%;
  height: 4px !important; border-radius: 2px; background: #18181b !important; outline: none; border: none !important;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 12px; height: 12px;
  border-radius: 50%; background: #22d3ee; cursor: pointer;
}
input[type=range]::-moz-range-thumb {
  width: 12px; height: 12px; border-radius: 50%;
  background: #22d3ee; cursor: pointer; border: none;
}
input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: #18181b; }
input[type=text], input[type=number], input[type=email], input[type=password], textarea {
  background: #18181b !important; border: 1px solid #232328 !important;
  color: #fafafa !important; padding: 0.375rem 0.75rem; border-radius: 0.375rem;
  font-size: 0.875rem; outline: none; font-family: inherit; width: 100%;
}
input[type=text]:focus, input[type=number]:focus, textarea:focus { border-color: #22d3ee !important; }
select {
  background: #18181b !important; border: 1px solid #232328 !important;
  color: #fafafa !important; padding: 0.375rem 0.75rem; border-radius: 0.375rem;
  font-size: 0.875rem; outline: none; font-family: inherit;
}
select:focus { border-color: #22d3ee !important; }
canvas { max-width: 100%; }
::selection { background: rgba(34, 211, 238, 0.2); }`;

const TOOLKIT_SCRIPTS = `<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
<script src="https://unpkg.com/three@0.170.0/build/three.min.js"><\/script>`;

export function buildSrcdoc(html: string): string {
	// Strip all <style> tags from model output to prevent theme conflicts
	let cleaned = html.replace(/<style[\s\S]*?<\/style>/gi, '');
	// Strip inline style from body/html tags (models add background-color etc.)
	cleaned = cleaned.replace(/<(body|html)(\s[^>]*)style="[^"]*"([^>]*)>/gi, '<$1$2$3>');
	// Inject our styles at the very end so they override everything
	const suffix = `\n<style>${TOOLKIT_CSS}</style>\n${TOOLKIT_SCRIPTS}`;
	return cleaned + suffix;
}
