<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import DownloadProgress from '$lib/components/DownloadProgress.svelte';
	import ServerStatus from '$lib/components/ServerStatus.svelte';
	import { page } from '$app/state';

	let { children } = $props();
	let sidebarOpen = $state(false);

	const navItems = [
		{
			href: '/models',
			label: 'Models',
			icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
		},
		{ href: '/search', label: 'Search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
		{
			href: '/chat',
			label: 'Chat',
			icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
		},
		{
			href: '/projects',
			label: 'Projects',
			icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z'
		},
		{
			href: '/compare',
			label: 'Compare',
			icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2'
		},
		{
			href: '/settings',
			label: 'Settings',
			icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z'
		}
	];

	function isActive(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>lmux</title>
</svelte:head>

<!-- Mobile menu button -->
<button
	class="fixed top-3 left-3 z-50 rounded-lg bg-[var(--color-elevated)] p-2 text-[var(--color-text-secondary)] md:hidden"
	onclick={() => (sidebarOpen = !sidebarOpen)}
	aria-label="Toggle sidebar"
>
	<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
	</svg>
</button>

<!-- Overlay for mobile -->
{#if sidebarOpen}
	<button
		class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
		onclick={() => (sidebarOpen = false)}
		aria-label="Close sidebar"
	></button>
{/if}

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<aside
		class="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-elevated)] transition-transform md:static md:translate-x-0
		{sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
	>
		<div class="flex h-12 items-center px-4">
			<a href="/" class="flex items-center gap-2">
				<span class="font-mono text-sm font-semibold tracking-tight text-[var(--color-accent)]"
					>lmux</span
				>
			</a>
		</div>

		<nav class="flex-1 px-2 py-1">
			{#each navItems as item}
				<a
					href={item.href}
					class="my-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors
					{isActive(item.href)
						? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
						: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]'}"
					onclick={() => (sidebarOpen = false)}
				>
					<svg
						class="h-4 w-4 shrink-0"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
					</svg>
					{item.label}
				</a>
			{/each}
		</nav>

		<ServerStatus />
	</aside>

	<!-- Main content -->
	<main class="min-w-0 flex-1">
		<div class="p-5 pt-14 md:p-8 md:pt-8">
			{@render children()}
		</div>
	</main>
</div>

<DownloadProgress />
