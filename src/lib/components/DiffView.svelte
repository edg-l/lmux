<script lang="ts">
	import { diffLines } from 'diff';

	interface Props {
		oldContent: string;
		newContent: string;
	}

	let { oldContent, newContent }: Props = $props();

	let changes = $derived(diffLines(oldContent, newContent));
</script>

<pre class="file-preview-code diff-view"><code class="hljs"
		>{#each changes as change, ci (ci)}{@const lines = change.value
				.replace(/\n$/, '')
				.split('\n')}{#each lines as line, li (li)}{#if change.added}<span
						class="diff-line diff-added">+{line || ' '}</span
					>{:else if change.removed}<span class="diff-line diff-removed">-{line || ' '}</span
					>{:else}<span class="diff-line diff-context"> {line || ' '}</span
					>{/if}{/each}{/each}</code
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
	:global(.diff-view .hljs) {
		background: none;
	}
</style>
