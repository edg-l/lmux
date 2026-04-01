<script lang="ts">
	import { hljs } from '$lib/markdown';
	import 'highlight.js/styles/github-dark.css';

	interface Props {
		projectId: number;
		filePath: string | null;
	}

	let { projectId, filePath }: Props = $props();

	let content = $state('');
	let totalLines = $state(0);
	let truncated = $state(false);
	let loading = $state(false);
	let error = $state('');

	const EXT_TO_LANG: Record<string, string> = {
		js: 'javascript',
		jsx: 'javascript',
		ts: 'typescript',
		tsx: 'typescript',
		py: 'python',
		rb: 'ruby',
		rs: 'rust',
		go: 'go',
		java: 'java',
		c: 'c',
		cpp: 'cpp',
		h: 'c',
		hpp: 'cpp',
		css: 'css',
		html: 'html',
		xml: 'xml',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		md: 'markdown',
		sh: 'bash',
		bash: 'bash',
		sql: 'sql',
		diff: 'diff',
		svelte: 'html'
	};

	function detectLanguage(path: string): string | null {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		return EXT_TO_LANG[ext] ?? null;
	}

	function highlightContent(text: string, path: string): string {
		const lang = detectLanguage(path);
		if (lang && hljs.getLanguage(lang)) {
			return hljs.highlight(text, { language: lang }).value;
		}
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	$effect(() => {
		if (filePath) {
			loadFile(filePath);
		}
	});

	async function loadFile(path: string) {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
			if (!res.ok) {
				error = 'Failed to load file';
				return;
			}
			const data = await res.json();
			content = data.content;
			totalLines = data.totalLines;
			truncated = data.truncated;
		} catch {
			error = 'Failed to load file';
		} finally {
			loading = false;
		}
	}
</script>

{#if !filePath}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-[var(--color-text-muted)]">Select a file to preview</p>
	</div>
{:else if loading}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-[var(--color-text-muted)]">Loading...</p>
	</div>
{:else if error}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-red-400">{error}</p>
	</div>
{:else}
	<div class="flex h-full flex-col">
		<!-- File header -->
		<div
			class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5"
		>
			<span class="truncate font-mono text-xs text-[var(--color-text-secondary)]">{filePath}</span>
			<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]"
				>{totalLines} lines</span
			>
		</div>

		{#if truncated}
			<div class="border-b border-amber-500/20 bg-amber-500/5 px-3 py-1.5">
				<span class="text-xs text-amber-400">
					File truncated ({totalLines.toLocaleString()} total lines)
				</span>
			</div>
		{/if}

		<!-- Code content -->
		<div class="flex-1 overflow-auto bg-[#0d1117]">
			<pre class="file-preview-code"><code class="hljs"
					>{@html (() => {
						const highlighted = highlightContent(content, filePath);
						return highlighted
							.split('\n')
							.map((line, i) => `<span class="line" data-line="${i + 1}">${line || ' '}</span>`)
							.join('');
					})()}</code
				></pre>
		</div>
	</div>
{/if}

<style>
	.file-preview-code {
		margin: 0;
		padding: 0.5rem 0.75rem 0.5rem 0;
		font-size: 0.8rem;
		line-height: 1.5;
		font-family: var(--font-mono);
	}
	.file-preview-code code {
		background: none;
		counter-reset: line;
	}
	:global(.file-preview-code .line) {
		display: block;
	}
	:global(.file-preview-code .line::before) {
		counter-increment: line;
		content: counter(line);
		display: inline-block;
		width: 4ch;
		margin-right: 1rem;
		padding-right: 0.5rem;
		text-align: right;
		color: var(--color-text-muted);
		opacity: 0.35;
		border-right: 1px solid var(--color-border);
		user-select: none;
		-webkit-user-select: none;
	}
	:global(.file-preview-code .hljs) {
		background: none;
	}
</style>
