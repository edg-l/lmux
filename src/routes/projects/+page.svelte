<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Project } from '$lib/types/chat';

	let projects = $state<Project[]>([]);
	let showBrowser = $state(false);
	let currentBrowsePath = $state('');
	let directories = $state<string[]>([]);
	let loadingBrowser = $state(false);
	let showHidden = $state(false);

	onMount(async () => {
		const res = await fetch('/api/projects');
		if (res.ok) projects = await res.json();
	});

	async function browseTo(path: string) {
		loadingBrowser = true;
		try {
			const params = new URLSearchParams({ path });
			if (showHidden) params.set('hidden', 'true');
			const res = await fetch(`/api/browse?${params}`);
			if (res.ok) {
				const data = await res.json();
				currentBrowsePath = data.path;
				directories = data.directories;
			}
		} catch {
			// ignore
		} finally {
			loadingBrowser = false;
		}
	}

	async function openBrowser() {
		showBrowser = true;
		await browseTo('');
	}

	function goUp() {
		const parent = currentBrowsePath.replace(/\/[^/]+\/?$/, '') || '/';
		browseTo(parent);
	}

	async function createProject(path: string) {
		const name = path.split('/').pop() || 'project';
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, path })
		});
		if (res.ok) {
			const project = await res.json();
			goto(`/projects/${project.id}`);
		}
	}

	async function deleteProject(id: number, e: Event) {
		e.stopPropagation();
		if (
			!confirm(
				'Delete this project? Conversations will be removed but files on disk are unchanged.'
			)
		)
			return;
		await fetch(`/api/projects/${id}`, { method: 'DELETE' });
		projects = projects.filter((p) => p.id !== id);
	}

	function formatRelativeTime(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString();
	}
</script>

<div class="mx-auto max-w-4xl">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-lg font-semibold text-[var(--color-text-primary)]">Projects</h1>
		<button
			onclick={openBrowser}
			class="rounded-lg bg-[var(--color-accent-dim)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]"
		>
			New Project
		</button>
	</div>

	<!-- Project cards grid -->
	{#if projects.length === 0}
		<div class="flex flex-col items-center justify-center py-20">
			<svg
				class="mb-4 h-12 w-12 text-[var(--color-text-muted)]"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="1"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
				/>
			</svg>
			<p class="text-sm text-[var(--color-text-muted)]">No projects yet</p>
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">
				Create one to start a coding workspace
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each projects as project (project.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					onclick={() => goto(`/projects/${project.id}`)}
					class="group relative flex cursor-pointer flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-hover)]"
				>
					<div class="mb-2 flex items-center gap-2">
						<svg
							class="h-4 w-4 shrink-0 text-[var(--color-accent)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
							/>
						</svg>
						<span class="truncate text-sm font-medium text-[var(--color-text-primary)]">
							{project.name}
						</span>
					</div>
					<p
						class="mb-3 truncate font-mono text-xs text-[var(--color-text-muted)]"
						title={project.path}
					>
						{project.path}
					</p>
					<span class="mt-auto text-xs text-[var(--color-text-muted)]">
						{formatRelativeTime(project.created_at)}
					</span>
					<!-- Delete button -->
					<button
						onclick={(e) => deleteProject(project.id, e)}
						class="absolute top-3 right-3 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
						aria-label="Delete project"
						title="Delete project"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
							/>
						</svg>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Directory browser overlay -->
{#if showBrowser}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div
			class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-2xl"
		>
			<!-- Browser header -->
			<div
				class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3"
			>
				<h2 class="text-sm font-medium text-[var(--color-text-primary)]">
					Select Project Directory
				</h2>
				<button
					onclick={() => (showBrowser = false)}
					class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
					aria-label="Close"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Current path -->
			<div
				class="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2"
			>
				<span class="min-w-0 truncate font-mono text-xs text-[var(--color-text-secondary)]">
					{currentBrowsePath}
				</span>
				<label class="ml-auto flex shrink-0 items-center gap-1.5">
					<input
						type="checkbox"
						bind:checked={showHidden}
						onchange={() => browseTo(currentBrowsePath)}
						class="accent-[var(--color-accent)]"
					/>
					<span class="text-xs text-[var(--color-text-muted)]">Hidden</span>
				</label>
			</div>

			<!-- Directory list -->
			<div class="flex-1 overflow-y-auto px-2 py-2">
				{#if loadingBrowser}
					<p class="py-4 text-center text-xs text-[var(--color-text-muted)]">Loading...</p>
				{:else}
					<!-- Go up -->
					{#if currentBrowsePath !== '/'}
						<button
							onclick={goUp}
							class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
						>
							<svg
								class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
								/>
							</svg>
							<span>..</span>
						</button>
					{/if}

					{#each directories as dir (dir)}
						<button
							onclick={() => browseTo(`${currentBrowsePath}/${dir}`)}
							class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
						>
							<svg
								class="h-4 w-4 shrink-0 text-[var(--color-accent)]"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
								/>
							</svg>
							<span class="font-mono">{dir}</span>
						</button>
					{/each}

					{#if directories.length === 0}
						<p class="py-4 text-center text-xs text-[var(--color-text-muted)]">No subdirectories</p>
					{/if}
				{/if}
			</div>

			<!-- Select button -->
			<div
				class="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3"
			>
				<button
					onclick={() => (showBrowser = false)}
					class="rounded-md border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
				>
					Cancel
				</button>
				<button
					onclick={() => createProject(currentBrowsePath)}
					class="rounded-md bg-[var(--color-accent-dim)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]"
				>
					Select this directory
				</button>
			</div>
		</div>
	</div>
{/if}
