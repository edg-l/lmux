<script lang="ts">
	interface Props {
		diff: string;
	}

	let { diff }: Props = $props();

	interface DiffLine {
		type: 'added' | 'removed' | 'context' | 'header';
		content: string;
	}

	let lines = $derived.by(() => {
		const result: DiffLine[] = [];
		for (const line of diff.split('\n')) {
			if (line.startsWith('@@')) {
				result.push({ type: 'header', content: line });
			} else if (line.startsWith('+') && !line.startsWith('+++')) {
				result.push({ type: 'added', content: line.slice(1) });
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				result.push({ type: 'removed', content: line.slice(1) });
			} else if (
				line.startsWith('diff ') ||
				line.startsWith('index ') ||
				line.startsWith('---') ||
				line.startsWith('+++')
			) {
				// skip diff metadata headers
			} else {
				result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
			}
		}
		return result;
	});
</script>

<pre class="diff-view"><code
		>{#each lines as line, i (i)}{#if line.type === 'header'}<span class="diff-line diff-header"
					>{line.content}</span
				>{:else if line.type === 'added'}<span class="diff-line diff-added"
					>+{line.content || ' '}</span
				>{:else if line.type === 'removed'}<span class="diff-line diff-removed"
					>-{line.content || ' '}</span
				>{:else}<span class="diff-line diff-context"> {line.content || ' '}</span>{/if}{/each}</code
	></pre>

<style>
	.diff-view {
		margin: 0;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		line-height: 1.5;
		font-family: var(--font-mono);
	}
	.diff-view code {
		background: none;
	}
	:global(.diff-view .diff-line) {
		display: block;
		padding: 0 0.5rem;
	}
	:global(.diff-view .diff-added) {
		background-color: #1a3a2a;
		color: #7ee787;
	}
	:global(.diff-view .diff-removed) {
		background-color: #3a1a1a;
		color: #f47067;
	}
	:global(.diff-view .diff-context) {
		color: var(--color-text-secondary);
	}
	:global(.diff-view .diff-header) {
		color: var(--color-accent);
		background-color: rgba(34, 211, 238, 0.05);
	}
	:global(.diff-view .hljs) {
		background: none;
	}
</style>
