<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import X from '~icons/lucide/x';
	import { readSettingsFile, saveSettingsFile } from '$lib/settings-client';
	import type { DirtyGuard } from './workspace/dirty-guard';
	let { dirtyGuard, onclose }: { dirtyGuard: DirtyGuard; onclose: () => void } = $props();
	let dialog: HTMLDialogElement;
	let text = $state(''), original = $state(''), revision = $state('');
	let path = $state('~/.hue/settings.json'), error = $state(''), notice = $state('');
	let busy = $state(false);
	const source = untrack(() => dirtyGuard.register(() => (text = original)));
	$effect(() => source.setDirty(text !== original));
	function guarded(action: () => void) { if (!dirtyGuard.block(action)) action(); }
	async function load() {
		busy = true; error = notice = '';
		try {
			const file = await readSettingsFile();
			text = original = file.text; revision = file.revision; path = file.path;
		} catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
		finally { busy = false; }
	}
	async function save() {
		busy = true; error = notice = '';
		const submitted = text;
		try {
			const saved = await saveSettingsFile(JSON.parse(submitted), revision);
			revision = saved.revision;
			original = JSON.stringify(saved.settings, null, 2) + '\n';
			if (text === submitted) text = original;
			notice = 'Saved. Your settings now apply across HUE.';
		} catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
		finally { busy = false; }
	}
	onMount(() => { dialog.showModal(); void load(); return () => source.unregister(); });
</script>

<dialog bind:this={dialog} class="global-panel bg-background p-0 text-foreground" aria-label="Edit HUE settings JSON"
	oncancel={(event) => { event.preventDefault(); guarded(onclose); }}>
	<section class="flex h-full min-h-0 flex-col">
		<header class="flex items-start gap-3 border-b border-border p-4">
			<div class="min-w-0 flex-1">
				<h1 class="text-lg font-semibold">Make HUE your own</h1>
				<p class="mt-1 break-all font-mono text-xs text-muted-foreground">{path}</p>
				<p class="mt-2 text-sm text-muted-foreground">Edit everything in one JSON file. Settings controls use this same file.</p>
			</div>
			<button class="grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent" aria-label="Close settings file" title="Close settings file" onclick={() => guarded(onclose)}><X aria-hidden="true" /></button>
		</header>
		<label for="hue-settings-json" class="px-4 pt-3 text-sm font-medium">settings.json{text !== original ? ' · Unsaved changes' : ''}</label>
		<textarea id="hue-settings-json" class="m-4 min-h-48 min-w-0 flex-1 resize-none rounded-md border border-input bg-muted/30 p-3 font-mono text-sm leading-6 focus-visible:outline-2 focus-visible:outline-ring" bind:value={text} spellcheck="false" autocapitalize="off" autocomplete="off" disabled={!revision || busy}></textarea>
		{#if error}<p role="alert" class="break-words px-4 pb-3 text-sm text-destructive">{error}</p>{/if}
		{#if notice}<p role="status" class="px-4 pb-3 text-sm">{notice}</p>{/if}
		<footer class="flex flex-wrap justify-end gap-2 border-t border-border p-3">
			<button class="min-h-11 rounded-md border border-border px-4 text-sm" disabled={busy} onclick={() => guarded(() => void load())}>Reload file</button>
			<button class="min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !revision || text === original} onclick={save}>{busy ? 'Working…' : 'Save settings'}</button>
		</footer>
	</section>
</dialog>

<style>
	#hue-settings-json { font-family: var(--font-mono, ui-monospace, monospace); tab-size: 2; }
</style>
