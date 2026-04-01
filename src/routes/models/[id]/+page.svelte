<script lang="ts">
	let { data } = $props();

	import { formatBytes, formatParams } from '$lib/format';

	interface Profile {
		id: number;
		model_id: number;
		name: string;
		gpu_layers: number | null;
		context_size: number | null;
		port: number;
		threads: number | null;
		batch_size: number | null;
		flash_attn: string;
		kv_cache_type: string;
		extra_flags: string | null;
		created_at: string;
	}

	let localProfiles: Profile[] | null = $state(null);
	let profiles = $derived(localProfiles ?? data.profiles);
	let showForm = $state(false);
	let editingId: number | null = $state(null);
	let formName = $state('');
	let formGpuLayers = $state('');
	let formContextSize = $state('');
	let formPort = $state('8080');
	let formThreads = $state('');
	let formBatchSize = $state('');
	let formFlashAttn = $state('auto');
	let formKvCacheType = $state('q8_0');
	let formExtraFlags = $state('');
	let generating = $state(false);
	let launchingId: number | null = $state(null);
	let launchError: string | null = $state(null);

	function resetForm() {
		formName = '';
		formGpuLayers = '';
		formContextSize = '';
		formPort = '8080';
		formThreads = '';
		formBatchSize = '';
		formFlashAttn = 'auto';
		formKvCacheType = 'q8_0';
		formExtraFlags = '';
		editingId = null;
		showForm = false;
	}

	function startEdit(profile: Profile) {
		editingId = profile.id;
		formName = profile.name;
		formGpuLayers = profile.gpu_layers != null ? String(profile.gpu_layers) : '';
		formContextSize = profile.context_size != null ? String(profile.context_size) : '';
		formPort = String(profile.port);
		formThreads = profile.threads != null ? String(profile.threads) : '';
		formBatchSize = profile.batch_size != null ? String(profile.batch_size) : '';
		formFlashAttn = profile.flash_attn ?? 'auto';
		formKvCacheType = profile.kv_cache_type ?? 'q8_0';
		formExtraFlags = profile.extra_flags ?? '';
		showForm = true;
	}

	function startCreate() {
		resetForm();
		showForm = true;
	}

	async function saveProfile() {
		const body = {
			name: formName,
			gpu_layers: formGpuLayers ? parseInt(formGpuLayers) : null,
			context_size: formContextSize ? parseInt(formContextSize) : null,
			port: parseInt(formPort) || 8080,
			threads: formThreads ? parseInt(formThreads) : null,
			batch_size: formBatchSize ? parseInt(formBatchSize) : null,
			flash_attn: formFlashAttn,
			kv_cache_type: formKvCacheType,
			extra_flags: formExtraFlags || null
		};

		if (editingId) {
			await fetch(`/api/models/${data.model.id}/profiles/${editingId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} else {
			await fetch(`/api/models/${data.model.id}/profiles`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		}

		const res = await fetch(`/api/models/${data.model.id}/profiles`);
		if (res.ok) localProfiles = await res.json();
		resetForm();
	}

	async function deleteProfile(profileId: number) {
		await fetch(`/api/models/${data.model.id}/profiles/${profileId}`, { method: 'DELETE' });
		localProfiles = profiles.filter((p) => p.id !== profileId);
	}

	async function launchProfile(profileId: number) {
		launchingId = profileId;
		launchError = null;
		try {
			const res = await fetch('/api/server/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ modelId: data.model.id, profileId })
			});
			if (!res.ok) {
				const body = await res.json();
				launchError = body.error ?? 'Failed to start server';
			}
		} catch (err) {
			launchError = err instanceof Error ? err.message : 'Failed to start server';
		} finally {
			launchingId = null;
		}
	}

	async function generateDefault() {
		generating = true;
		try {
			const res = await fetch(`/api/models/${data.model.id}/profiles?default=true`, {
				method: 'POST'
			});
			if (res.ok) {
				const refreshRes = await fetch(`/api/models/${data.model.id}/profiles`);
				if (refreshRes.ok) localProfiles = await refreshRes.json();
			}
		} finally {
			generating = false;
		}
	}

	// Extract a nice display name from filename
	function displayName(filename: string): string {
		return filename.replace(/\.gguf$/i, '');
	}
</script>

<div class="mx-auto max-w-6xl">
	<a
		href="/models"
		class="mb-6 inline-flex items-center gap-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase transition-colors hover:text-[var(--color-text-secondary)]"
	>
		<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
		</svg>
		Models
	</a>

	<h1 class="mb-6 font-mono text-xl font-semibold text-[var(--color-text-primary)]">
		{displayName(data.model.filename)}
	</h1>

	<!-- Model metadata -->
	<div
		class="mb-8 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)]"
	>
		<div class="border-b border-[var(--color-border)] px-5 py-3">
			<h2 class="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
				Model Details
			</h2>
		</div>
		<div class="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-3">
			<div class="bg-[var(--color-elevated)] px-5 py-3">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Architecture</p>
				<p class="mt-1 font-mono text-sm text-[var(--color-text-primary)]">
					{data.model.architecture ?? '--'}
				</p>
			</div>
			<div class="bg-[var(--color-elevated)] px-5 py-3">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Parameters</p>
				<p class="mt-1 font-mono text-sm text-[var(--color-text-primary)]">
					{formatParams(data.model.parameter_count) || '--'}
				</p>
			</div>
			<div class="bg-[var(--color-elevated)] px-5 py-3">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Quantization</p>
				<p class="mt-1 font-mono text-sm text-[var(--color-accent)]">
					{data.model.quant_type ?? '--'}
				</p>
			</div>
			<div class="bg-[var(--color-elevated)] px-5 py-3">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Context</p>
				<p class="mt-1 font-mono text-sm text-[var(--color-text-primary)]">
					{data.model.context_length ? data.model.context_length.toLocaleString() : '--'}
				</p>
			</div>
			<div class="bg-[var(--color-elevated)] px-5 py-3">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">File Size</p>
				<p class="mt-1 font-mono text-sm text-[var(--color-text-primary)]">
					{formatBytes(data.model.size_bytes ?? 0)}
				</p>
			</div>
			{#if data.model.block_count}
				<div class="bg-[var(--color-elevated)] px-5 py-3">
					<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Layers</p>
					<p class="mt-1 font-mono text-sm text-[var(--color-text-primary)]">
						{data.model.block_count}
					</p>
				</div>
			{/if}
			{#if !data.model.block_count}
				<!-- Fill empty cell when no layers data -->
				<div class="bg-[var(--color-elevated)]"></div>
			{/if}
			{#if data.model.hf_repo}
				<div class="col-span-2 bg-[var(--color-elevated)] px-5 py-3 sm:col-span-3">
					<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase">Source</p>
					<p
						class="mt-1 truncate font-mono text-sm text-[var(--color-text-secondary)]"
						title={data.model.hf_repo}
					>
						{data.model.hf_repo}
					</p>
				</div>
			{/if}
		</div>
		<div class="border-t border-[var(--color-border)] bg-[var(--color-elevated)] px-5 py-2.5">
			<p
				class="truncate font-mono text-xs text-[var(--color-text-muted)]"
				title={data.model.filepath}
			>
				{data.model.filepath}
			</p>
		</div>
	</div>

	{#if launchError}
		<div
			class="mb-6 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3"
		>
			<svg
				class="mt-0.5 h-4 w-4 shrink-0 text-red-400"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
				/>
			</svg>
			<p class="flex-1 text-sm text-red-300">{launchError}</p>
			<button
				onclick={() => (launchError = null)}
				class="text-xs text-red-400/60 hover:text-red-300">Dismiss</button
			>
		</div>
	{/if}

	<!-- Launch Profiles -->
	<div>
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Launch Profiles</h2>
			<div class="flex gap-2">
				<button
					onclick={generateDefault}
					disabled={generating}
					class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
				>
					{generating ? 'Generating...' : 'Auto Generate'}
				</button>
				<button
					onclick={startCreate}
					class="rounded-md bg-[var(--color-accent-dim)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]"
				>
					New Profile
				</button>
			</div>
		</div>

		{#if profiles.length === 0 && !showForm}
			<div
				class="rounded-lg border border-dashed border-[var(--color-border)] px-6 py-10 text-center"
			>
				<p class="text-sm text-[var(--color-text-muted)]">No launch profiles yet</p>
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">
					Click "Auto Generate" to create one based on your hardware.
				</p>
			</div>
		{/if}

		<div class="space-y-2">
			{#each profiles as profile}
				<div
					class="group rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4 transition-colors hover:border-[var(--color-border-active)]"
				>
					<div class="flex items-center justify-between">
						<div class="min-w-0 flex-1">
							<h3 class="text-sm font-medium text-[var(--color-text-primary)]">{profile.name}</h3>
							<div
								class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[var(--color-text-muted)]"
							>
								<span
									>ngl <span class="text-[var(--color-text-secondary)]"
										>{profile.gpu_layers ?? 'auto'}{data.model.block_count
											? `/${data.model.block_count + 1}`
											: ''}</span
									></span
								>
								<span
									>ctx <span class="text-[var(--color-text-secondary)]"
										>{profile.context_size?.toLocaleString() ?? 'auto'}</span
									></span
								>
								{#if profile.threads}<span
										>threads <span class="text-[var(--color-text-secondary)]"
											>{profile.threads}</span
										></span
									>{/if}
								{#if profile.batch_size}<span
										>batch <span class="text-[var(--color-text-secondary)]"
											>{profile.batch_size}</span
										></span
									>{/if}
								<span
									>fa <span class="text-[var(--color-text-secondary)]">{profile.flash_attn}</span
									></span
								>
								<span
									>kv <span class="text-[var(--color-text-secondary)]">{profile.kv_cache_type}</span
									></span
								>
								<span
									>port <span class="text-[var(--color-text-secondary)]">{profile.port}</span></span
								>
								{#if profile.extra_flags}
									<span class="max-w-48 truncate" title={profile.extra_flags}
										>{profile.extra_flags}</span
									>
								{/if}
							</div>
						</div>
						<div class="ml-4 flex items-center gap-1.5">
							<button
								onclick={() => launchProfile(profile.id)}
								disabled={launchingId === profile.id}
								class="rounded-md bg-[var(--color-accent-dim)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
							>
								{launchingId === profile.id ? 'Starting...' : 'Launch'}
							</button>
							<button
								onclick={() => startEdit(profile)}
								class="rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] opacity-0 transition-all group-hover:opacity-100 hover:text-[var(--color-text-primary)]"
							>
								Edit
							</button>
							<button
								onclick={() => deleteProfile(profile.id)}
								class="rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Profile form -->
		{#if showForm}
			<div
				class="mt-3 rounded-lg border border-[var(--color-accent)]/20 bg-[var(--color-elevated)] p-5"
			>
				<h3
					class="mb-4 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
				>
					{editingId ? 'Edit Profile' : 'New Profile'}
				</h3>
				<div class="grid grid-cols-3 gap-4">
					<div class="col-span-3 sm:col-span-1">
						<label
							for="profile-name"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Name</label
						>
						<input
							id="profile-name"
							type="text"
							bind:value={formName}
							placeholder="Profile name"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-sans text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-gpu"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>GPU Layers</label
						>
						<input
							id="profile-gpu"
							type="number"
							bind:value={formGpuLayers}
							placeholder="Auto"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-ctx"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Context Size</label
						>
						<input
							id="profile-ctx"
							type="number"
							bind:value={formContextSize}
							placeholder="Auto"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-threads"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Threads</label
						>
						<input
							id="profile-threads"
							type="number"
							bind:value={formThreads}
							placeholder="Auto"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-batch"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Batch Size</label
						>
						<input
							id="profile-batch"
							type="number"
							bind:value={formBatchSize}
							placeholder="Auto"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-port"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Port</label
						>
						<input
							id="profile-port"
							type="number"
							bind:value={formPort}
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
					<div>
						<label
							for="profile-fa"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Flash Attention</label
						>
						<select
							id="profile-fa"
							bind:value={formFlashAttn}
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
						>
							<option value="auto">auto</option>
							<option value="true">enabled</option>
							<option value="false">disabled</option>
						</select>
					</div>
					<div>
						<label
							for="profile-kv"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>KV Cache Type</label
						>
						<select
							id="profile-kv"
							bind:value={formKvCacheType}
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
						>
							<option value="f16">f16</option>
							<option value="q8_0">q8_0</option>
							<option value="q4_0">q4_0</option>
						</select>
					</div>
					<div>
						<label
							for="profile-flags"
							class="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)] uppercase"
							>Extra Flags</label
						>
						<input
							id="profile-flags"
							type="text"
							bind:value={formExtraFlags}
							placeholder="--mlock"
							class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					</div>
				</div>
				<div class="mt-4 flex gap-2">
					<button
						onclick={saveProfile}
						disabled={!formName.trim()}
						class="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
					>
						{editingId ? 'Update' : 'Create'}
					</button>
					<button
						onclick={resetForm}
						class="rounded-md px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
