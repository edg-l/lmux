import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('java', java);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('diff', diff);

marked.use(
	markedHighlight({
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			if (lang && hljs.getLanguage(lang)) {
				return hljs.highlight(code, { language: lang }).value;
			}
			return code;
		}
	}),
	{
		renderer: {
			link({ href, text }) {
				return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
			},
			code({ text, lang }) {
				const trimmed = text.replace(/\s+$/, '');
				const lines = trimmed
					.split('\n')
					.map((line) => `<span class="line">${line || ' '}</span>`)
					.join('');
				const header = `<div class="code-header"><span class="code-lang">${lang || ''}</span><button class="code-copy">Copy</button></div>`;
				return `<div class="code-block">${header}<pre class="code-content"><code class="hljs${lang ? ` language-${lang}` : ''}">${lines}</code></pre></div>`;
			}
		}
	}
);

marked.setOptions({ breaks: true, gfm: true });

function renderMath(text: string): string {
	const codeBlocks: string[] = [];
	text = text.replace(/```[\s\S]*?```/g, (match) => {
		codeBlocks.push(match);
		return `\x00CODE${codeBlocks.length - 1}\x00`;
	});
	const inlineCodes: string[] = [];
	text = text.replace(/`[^`]+`/g, (match) => {
		inlineCodes.push(match);
		return `\x00INLINE${inlineCodes.length - 1}\x00`;
	});

	// Block math: $$...$$
	text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
		try {
			return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
		} catch {
			return `<pre class="math-error">${math}</pre>`;
		}
	});
	// Inline math: $...$
	text = text.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, math) => {
		try {
			return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
		} catch {
			return `<code>${math}</code>`;
		}
	});

	text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);
	text = text.replace(/\x00INLINE(\d+)\x00/g, (_, idx) => inlineCodes[parseInt(idx)]);
	return text;
}

const SANITIZE_OPTIONS = {
	ADD_TAGS: [
		'semantics',
		'annotation',
		'mrow',
		'mi',
		'mn',
		'mo',
		'msup',
		'msub',
		'mfrac',
		'mover',
		'munder',
		'msqrt',
		'mtext',
		'mspace',
		'mtable',
		'mtr',
		'mtd',
		'math'
	],
	ADD_ATTR: [
		'target',
		'rel',
		'xmlns',
		'mathvariant',
		'stretchy',
		'fence',
		'separator',
		'accent',
		'accentunder',
		'columnalign',
		'columnspacing',
		'rowspacing',
		'displaystyle',
		'scriptlevel',
		'encoding',
		'lspace',
		'rspace',
		'movablelimits',
		'symmetric'
	]
};

export function renderMarkdown(text: string): string {
	const withMath = renderMath(text);
	const html = marked.parse(withMath, { async: false }) as string;
	return DOMPurify.sanitize(html, SANITIZE_OPTIONS);
}

export { hljs };
