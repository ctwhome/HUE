<script lang="ts">
	import { Archive, CircleAlert, CircleHelp, LoaderCircle, Search, X, Zap } from 'lucide-svelte';
	import { tick } from 'svelte';
	import type { SessionFinderResult } from './types';

	let {
		open = $bindable(),
		onnavigate
	}: {
		open: boolean;
		onnavigate: (result: SessionFinderResult) => void;
	} = $props();
	let dialog: HTMLDialogElement;
	let input: HTMLInputElement;
	let query = $state('');
	let status = $state<SessionFinderResult['status']>(null);
	let results = $state<SessionFinderResult[]>([]);
	let loading = $state(false);
	let error = $state('');
	let generation = 0;
	const filters = [
		{ value: 'running', label: 'Running', icon: Zap },
		{ value: 'waiting', label: 'Waiting', icon: CircleHelp },
		{ value: 'unknown', label: 'Unknown', icon: CircleAlert },
		{ value: 'failed', label: 'Failed', icon: CircleAlert },
		{ value: 'archived', label: 'Archived', icon: Archive }
	] as const;

	async function search() {
		const request = ++generation;
		loading = true;
		error = '';
		const params = new URLSearchParams();
		if (query.trim()) params.set('q', query.trim());
		if (status) params.set('status', status);
		try {
			const response = await fetch(`/api/sessions/search${params.size ? `?${params}` : ''}`);
			const body = (await response.json()) as {
				results?: SessionFinderResult[];
				error?: string;
			};
			if (request !== generation) return;
			if (!response.ok) throw new Error(body.error ?? `Search failed (${response.status})`);
			results = body.results ?? [];
		} catch (cause) {
			if (request === generation) {
				results = [];
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request === generation) loading = false;
		}
	}

	function close() {
		generation += 1;
		open = false;
		dialog.close();
	}

	function choose(result: SessionFinderResult) {
		close();
		onnavigate(result);
	}

	$effect(() => {
		if (open && dialog && !dialog.open) {
			query = '';
			status = null;
			results = [];
			dialog.showModal();
			void search();
			void tick().then(() => input.focus());
		} else if (!open && dialog?.open) {
			generation += 1;
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[calc(100dvh-24px)] w-[min(720px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/70"
	aria-labelledby="session-finder-title"
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<div class="grid max-h-[calc(100dvh-24px)] min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
		<header class="flex min-w-0 items-center gap-3 border-b border-border p-3 sm:p-4">
			<Search class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<h2 id="session-finder-title" class="font-semibold">Find a Session</h2>
				<p class="truncate text-xs text-muted-foreground">Search all HUE-indexed Sessions</p>
			</div>
			<button
				type="button"
				class="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Close Session finder"
				title="Close Session finder"
				onclick={close}><X class="size-5" aria-hidden="true" /></button
			>
		</header>
		<div class="grid min-w-0 gap-3 border-b border-border p-3 sm:p-4">
			<label class="relative min-w-0">
				<span class="sr-only">Search Sessions</span>
				<Search
					class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					bind:this={input}
					bind:value={query}
					type="search"
					class="h-11 w-full min-w-0 rounded-lg border border-input bg-background pr-10 pl-10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
					placeholder="Title, tag, folder, or message"
					oninput={() => void search()}
				/>
				{#if loading}<LoaderCircle
						class="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
						aria-label="Searching"
					/>{/if}
			</label>
			<div class="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Session status filters">
				{#each filters as filter}
					<button
						type="button"
						class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
						class:border-primary={status === filter.value}
						class:bg-primary={status === filter.value}
						class:text-primary-foreground={status === filter.value}
						aria-pressed={status === filter.value}
						onclick={() => {
							status = status === filter.value ? null : filter.value;
							void search();
						}}
					>
						<filter.icon class="size-3.5" aria-hidden="true" />{filter.label}
					</button>
				{/each}
			</div>
		</div>
		<div class="min-w-0 overflow-y-auto p-2 sm:p-3" aria-live="polite" aria-busy={loading}>
			{#if error}
				<p class="p-3 text-sm text-destructive">{error}</p>
			{:else if !loading && results.length === 0}
				<p class="p-6 text-center text-sm text-muted-foreground">No matching Sessions</p>
			{:else}
				<ul class="grid min-w-0 gap-1">
					{#each results as result (result.sessionId)}
						<li class="min-w-0">
							<button
								type="button"
								class="grid min-h-11 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
								onclick={() => choose(result)}
							>
								<span class="min-w-0">
									<strong class="block truncate text-sm"
										>{result.title ?? 'Untitled Hermes Session'}</strong
									>
									<span class="block truncate text-xs text-muted-foreground">
										{result.projectName ?? 'Projectless'}{result.folder
											? ` / ${result.folder}`
											: ''}
									</span>
								</span>
								{#if result.status}<span class="rounded-full border px-2 py-1 text-xs capitalize"
										>{result.status}</span
									>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</dialog>
