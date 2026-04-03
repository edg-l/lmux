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
	let landlockAvailable: boolean | null = $state(null);
	let memoryEnabled = $state(true);

	// Sandbox rules state
	let writablePaths = $state<Array<{ id: number; path: string; created_at: string }>>([]);
	let approvedCommands = $state<Array<{ id: number; pattern: string; created_at: string }>>([]);
	let deletingPath = $state<number | null>(null);
	let deletingCommand = $state<number | null>(null);

	async function loadWritablePaths() {
		try {
			const res = await fetch('/api/sandbox/writable-paths');
			if (res.ok) writablePaths = await res.json();
		} catch {
			/* ignore */
		}
	}

	async function loadApprovedCommands() {
		try {
			const res = await fetch('/api/sandbox/approved-commands');
			if (res.ok) approvedCommands = await res.json();
		} catch {
			/* ignore */
		}
	}

	async function deleteWritablePath(id: number) {
		deletingPath = id;
		try {
			const res = await fetch('/api/sandbox/writable-paths', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				writablePaths = writablePaths.filter((p) => p.id !== id);
			}
		} finally {
			deletingPath = null;
		}
	}

	async function deleteApprovedCommand(id: number) {
		deletingCommand = id;
		try {
			const res = await fetch('/api/sandbox/approved-commands', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				approvedCommands = approvedCommands.filter((c) => c.id !== id);
			}
		} finally {
			deletingCommand = null;
		}
	}

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
				memoryEnabled = settings.memory_enabled !== 'false';
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

	async function checkLandlock() {
		try {
			const res = await fetch('/api/settings/check-landlock');
			if (res.ok) {
				const data = await res.json();
				landlockAvailable = data.available;
			}
		} catch {
			landlockAvailable = false;
		}
	}

	import { onMount } from 'svelte';
	onMount(() => {
		loadSettings();
		checkLandlock();
		loadWritablePaths();
		loadApprovedCommands();
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

			<!-- Model Memory -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-5">
				<div class="flex items-center justify-between">
					<div>
						<h2
							class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
						>
							Model Memory
						</h2>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							Allow models to store and recall notes across conversations. Notes are saved per model
							in <code class="font-mono text-[var(--color-text-secondary)]"
								>~/.local/share/lmux/notes/</code
							>.
						</p>
					</div>
					<button
						onclick={async () => {
							memoryEnabled = !memoryEnabled;
							try {
								await fetch('/api/settings', {
									method: 'PUT',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										key: 'memory_enabled',
										value: memoryEnabled ? 'true' : 'false'
									})
								});
							} catch {
								memoryEnabled = !memoryEnabled;
							}
						}}
						title={memoryEnabled ? 'Disable model memory' : 'Enable model memory'}
						class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors {memoryEnabled
							? 'bg-[var(--color-accent)]'
							: 'bg-[var(--color-border)]'}"
					>
						<span
							class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {memoryEnabled
								? 'translate-x-4.5'
								: 'translate-x-0.5'}"
						></span>
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

			<!-- Landlock Sandbox Status -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
				<div class="mb-1 flex items-center gap-2">
					<h2 class="text-xs font-semibold text-[var(--color-text-primary)]">
						Sandbox (landlock-restrict)
					</h2>
					{#if landlockAvailable === null}
						<span class="text-xs text-[var(--color-text-muted)]">Checking...</span>
					{:else if landlockAvailable}
						<span class="text-xs text-emerald-400">Detected</span>
					{:else}
						<span class="text-xs text-amber-400">Not found</span>
					{/if}
				</div>
				<p class="mb-2 text-xs text-[var(--color-text-muted)]">
					Used to sandbox shell commands in project mode. Restricts writes to the project directory
					only.
				</p>
				{#if landlockAvailable === false}
					<div class="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300">
						<p class="mb-1 font-medium">Install landlock-restrict:</p>
						<code class="text-[0.7rem]"
							>go install github.com/landlock-lsm/go-landlock/cmd/landlock-restrict@latest</code
						>
						<p class="mt-1 text-[var(--color-text-muted)]">
							Requires Linux 5.13+ with Landlock enabled. Commands will run unsandboxed until
							installed.
						</p>
					</div>
				{/if}
			</div>

			<!-- Sandbox Rules -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
				<h2
					class="mb-3 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
				>
					Sandbox Rules
				</h2>

				<!-- Writable Paths -->
				<div class="mb-4">
					<h3 class="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
						Writable Paths
					</h3>
					{#if writablePaths.length === 0}
						<p class="text-xs text-[var(--color-text-muted)]">(none)</p>
					{:else}
						<div class="space-y-1">
							{#each writablePaths as wp}
								<div
									class="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5"
								>
									<span class="min-w-0 truncate font-mono text-xs text-[var(--color-text-primary)]">
										{wp.path}
									</span>
									<button
										onclick={() => deleteWritablePath(wp.id)}
										disabled={deletingPath === wp.id}
										class="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
									>
										{deletingPath === wp.id ? '...' : 'Delete'}
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Approved Commands -->
				<div>
					<h3 class="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
						Approved Commands
					</h3>
					{#if approvedCommands.length === 0}
						<p class="text-xs text-[var(--color-text-muted)]">(none)</p>
					{:else}
						<div class="space-y-1">
							{#each approvedCommands as cmd}
								<div
									class="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5"
								>
									<span class="min-w-0 truncate font-mono text-xs text-[var(--color-text-primary)]">
										{cmd.pattern}
									</span>
									<button
										onclick={() => deleteApprovedCommand(cmd.id)}
										disabled={deletingCommand === cmd.id}
										class="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
									>
										{deletingCommand === cmd.id ? '...' : 'Delete'}
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<HardwareInfo />
		</div>
	{/if}
</div>
