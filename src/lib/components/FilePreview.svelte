<script lang="ts">
	import { hljs } from '$lib/markdown';
	import 'highlight.js/styles/github-dark.css';
	import DiffView from './DiffView.svelte';

	interface Props {
		projectId: number;
		filePath: string | null;
	}

	let { projectId, filePath }: Props = $props();

	let diffMode = $state(true);

	let content = $state('');
	let totalLines = $state(0);
	let truncated = $state(false);
	let loading = $state(false);
	let error = $state('');
	let gitDiff = $state<string | null>(null);

	// Only needed for extensions/filenames that don't match a registered hljs language name
	const LANG_OVERRIDES: Record<string, string> = {
		h: 'c',
		hpp: 'cpp',
		jsx: 'javascript',
		tsx: 'typescript',
		svelte: 'html',
		cfg: 'ini',
		conf: 'ini',
		log: 'plaintext'
	};

	const FILENAME_OVERRIDES: Record<string, string> = {
		Dockerfile: 'dockerfile',
		Makefile: 'makefile',
		'Cargo.lock': 'toml'
	};

	function detectLanguage(path: string): string | null {
		const filename = path.split('/').pop() ?? '';
		if (FILENAME_OVERRIDES[filename]) return FILENAME_OVERRIDES[filename];
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		return LANG_OVERRIDES[ext] ?? (ext || null);
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
		gitDiff = null;
		try {
			const [fileRes, diffRes] = await Promise.all([
				fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
				fetch(`/api/projects/${projectId}/diff?path=${encodeURIComponent(path)}`)
			]);
			if (!fileRes.ok) {
				error = 'Failed to load file';
				return;
			}
			const data = await fileRes.json();
			content = data.content;
			totalLines = data.totalLines;
			truncated = data.truncated;

			if (diffRes.ok) {
				const diffData = await diffRes.json();
				gitDiff = diffData.diff ?? null;
			}
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
			<div class="flex shrink-0 items-center gap-2">
				{#if gitDiff}
					<div class="flex overflow-hidden rounded border border-[var(--color-border)]">
						<button
							onclick={() => (diffMode = false)}
							class="px-2 py-0.5 text-xs font-medium transition-colors {!diffMode
								? 'bg-[var(--color-accent-dim)] text-white'
								: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
						>
							Full
						</button>
						<button
							onclick={() => (diffMode = true)}
							class="border-l border-[var(--color-border)] px-2 py-0.5 text-xs font-medium transition-colors {diffMode
								? 'bg-[var(--color-accent-dim)] text-white'
								: 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
						>
							Diff
						</button>
					</div>
				{/if}
				<span class="font-mono text-xs text-[var(--color-text-muted)]">{totalLines} lines</span>
			</div>
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
			{#if diffMode && gitDiff}
				<DiffView diff={gitDiff} />
			{:else}
				<pre class="file-preview-code"><code class="hljs"
						>{@html (() => {
							const highlighted = highlightContent(content, filePath);
							return highlighted
								.split('\n')
								.map((line, i) => `<span class="line" data-line="${i + 1}">${line || ' '}</span>`)
								.join('');
						})()}</code
					></pre>
			{/if}
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
