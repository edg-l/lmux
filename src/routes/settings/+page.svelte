<script lang="ts">
	import HardwareInfo from '$lib/components/HardwareInfo.svelte';

	let modelsDir = $state('');
	let llamaServerPath = $state('');
	let hfToken = $state('');
	let hfTokenSource: string | null = $state(null);
	let searxngUrl = $state('');
	let kvCacheDir = $state('');
	let systemPrompt = $state('');
	let loading = $state(true);
	let saving = $state<Record<string, boolean>>({});
	let saved = $state<Record<string, boolean>>({});
	let detectingBinary = $state(false);
	let searxngStatus: 'idle' | 'checking' | 'ok' | 'error' = $state('idle');
	let searxngError = $state('');

	async function loadSettings() {
		loading = true;
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const settings = await res.json();
				modelsDir = settings.models_dir ?? '';
				llamaServerPath = settings.llama_server_path ?? '';
				hfToken = settings.hf_token ?? '';
				hfTokenSource = settings.hf_token_source ?? null;
				searxngUrl = settings.searxng_url ?? '';
				kvCacheDir = settings.kv_cache_dir ?? '';
				systemPrompt = settings.system_prompt ?? '';
			}
		} finally {
			loading = false;
		}
	}

	async function saveSetting(key: string, value: string) {
		saving[key] = true;
		saved[key] = false;
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key, value })
			});
			if (res.ok) {
				saved[key] = true;
				setTimeout(() => (saved[key] = false), 2000);
			}
		} finally {
			saving[key] = false;
		}
	}

	async function autoDetectBinary() {
		detectingBinary = true;
		try {
			const res = await fetch('/api/settings/detect-llama-server');
			if (res.ok) {
				const body = await res.json();
				if (body.path) {
					llamaServerPath = body.path;
					await saveSetting('llama_server_path', body.path);
				}
			}
		} finally {
			detectingBinary = false;
		}
	}

	async function testSearxng() {
		if (!searxngUrl.trim()) return;
		searxngStatus = 'checking';
		searxngError = '';
		try {
			const res = await fetch('/api/settings/test-searxng', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: searxngUrl })
			});
			const data = await res.json();
			if (res.ok && data.ok) {
				searxngStatus = 'ok';
				setTimeout(() => (searxngStatus = 'idle'), 3000);
			} else {
				searxngStatus = 'error';
				searxngError = data.error ?? 'Unknown error';
			}
		} catch {
			searxngStatus = 'error';
			searxngError = 'Failed to connect';
		}
	}

	function saveButtonLabel(key: string): string {
		if (saving[key]) return 'Saving...';
		if (saved[key]) return 'Saved';
		return 'Save';
	}

	function saveButtonClass(key: string): string {
		if (saved[key]) return 'border-emerald-500/30 text-emerald-400';
		return 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]';
	}

	import { onMount } from 'svelte';
	onMount(() => {
		loadSettings();
	});
</script>

<div class="mx-auto max-w-5xl">
	<h1 class="mb-6 text-sm font-semibold text-[var(--color-text-primary)]">Settings</h1>

	{#if loading}
		<p class="text-sm text-[var(--color-text-muted)]">Loading...</p>
	{:else}
		<div class="space-y-5">
			<!-- Models Directory -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					Models Directory
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					Where GGUF files are stored. Also scans the HuggingFace cache automatically.
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={modelsDir}
						class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<button
						onclick={() => saveSetting('models_dir', modelsDir)}
						disabled={saving['models_dir']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'models_dir'
						)}"
					>
						{saveButtonLabel('models_dir')}
					</button>
				</div>
			</div>

			<!-- llama-server Binary -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					llama-server Binary
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					Path to the llama-server executable.
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={llamaServerPath}
						placeholder="/usr/bin/llama-server"
						class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<button
						onclick={autoDetectBinary}
						disabled={detectingBinary}
						class="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)] disabled:opacity-50"
					>
						{detectingBinary ? 'Detecting...' : 'Detect'}
					</button>
					<button
						onclick={() => saveSetting('llama_server_path', llamaServerPath)}
						disabled={saving['llama_server_path']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'llama_server_path'
						)}"
					>
						{saveButtonLabel('llama_server_path')}
					</button>
				</div>
			</div>

			<!-- KV Cache Directory -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					KV Cache Directory
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					Directory to save/restore KV cache state per slot. Enables conversation context
					persistence across server restarts. Leave empty to disable.
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={kvCacheDir}
						placeholder="/path/to/kv-cache"
						class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<button
						onclick={() => saveSetting('kv_cache_dir', kvCacheDir)}
						disabled={saving['kv_cache_dir']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'kv_cache_dir'
						)}"
					>
						{saveButtonLabel('kv_cache_dir')}
					</button>
				</div>
			</div>

			<!-- System Prompt -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					System Prompt
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					Default system prompt injected at the start of every conversation. Can be overridden per
					model.
				</p>
				<textarea
					bind:value={systemPrompt}
					rows={5}
					placeholder="You are a helpful assistant."
					class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
				></textarea>
				<p class="mt-1 mb-2 text-xs text-[var(--color-text-muted)]">
					Available variables: <code class="font-mono text-[var(--color-text-secondary)]"
						>&#123;&#123;date&#125;&#125;</code
					>,
					<code class="font-mono text-[var(--color-text-secondary)]"
						>&#123;&#123;time&#125;&#125;</code
					>,
					<code class="font-mono text-[var(--color-text-secondary)]"
						>&#123;&#123;day&#125;&#125;</code
					>,
					<code class="font-mono text-[var(--color-text-secondary)]"
						>&#123;&#123;model&#125;&#125;</code
					>,
					<code class="font-mono text-[var(--color-text-secondary)]"
						>&#123;&#123;user&#125;&#125;</code
					>
				</p>
				<div class="flex justify-end">
					<button
						onclick={() => saveSetting('system_prompt', systemPrompt)}
						disabled={saving['system_prompt']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'system_prompt'
						)}"
					>
						{saveButtonLabel('system_prompt')}
					</button>
				</div>
			</div>

			<!-- HuggingFace Token -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					HuggingFace Token
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					For accessing gated models. Also checks <code
						class="font-mono text-[var(--color-text-secondary)]">HF_TOKEN</code
					>
					env var and
					<code class="font-mono text-[var(--color-text-secondary)]"
						>~/.cache/huggingface/token</code
					>.
				</p>
				{#if hfTokenSource}
					<div
						class="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
						<span class="text-xs text-emerald-300"
							>Token detected from <code class="font-mono">{hfTokenSource}</code></span
						>
					</div>
				{/if}
				<div class="flex gap-2">
					<input
						type="password"
						bind:value={hfToken}
						placeholder="hf_..."
						class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<button
						onclick={() => saveSetting('hf_token', hfToken)}
						disabled={saving['hf_token']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'hf_token'
						)}"
					>
						{saveButtonLabel('hf_token')}
					</button>
				</div>
			</div>

			<!-- SearXNG URL -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
					SearXNG URL
				</h2>
				<p class="mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
					URL of a SearXNG instance for web search tool. Leave empty to disable web search.
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={searxngUrl}
						placeholder="http://localhost:8888"
						class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<button
						onclick={testSearxng}
						disabled={searxngStatus === 'checking' || !searxngUrl.trim()}
						class="rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {searxngStatus ===
						'ok'
							? 'border-emerald-500/30 text-emerald-400'
							: searxngStatus === 'error'
								? 'border-red-500/30 text-red-400'
								: 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)]'}"
					>
						{#if searxngStatus === 'checking'}
							Testing...
						{:else if searxngStatus === 'ok'}
							OK
						{:else if searxngStatus === 'error'}
							Failed
						{:else}
							Test
						{/if}
					</button>
					<button
						onclick={() => saveSetting('searxng_url', searxngUrl)}
						disabled={saving['searxng_url']}
						class="rounded-md border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 {saveButtonClass(
							'searxng_url'
						)}"
					>
						{saveButtonLabel('searxng_url')}
					</button>
				</div>
				{#if searxngStatus === 'error' && searxngError}
					<p class="mt-2 text-xs text-red-400">{searxngError}</p>
				{/if}
			</div>

			<HardwareInfo />
		</div>
	{/if}
</div>
