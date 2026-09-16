<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { initializeSettings, refreshSettings, settingsStatus } from '$lib/settings-client';
	import Workspace from '$lib/components/Workspace.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	if (browser) untrack(() => initializeSettings(data.settings, data.settingsError));
	onMount(() => {
		const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshSettings(); }, 2000);
		window.addEventListener('focus', refreshSettings);
		return () => { clearInterval(timer); window.removeEventListener('focus', refreshSettings); };
	});
</script>

<svelte:window onbeforeunload={(event) => { if ($settingsStatus.pending) event.preventDefault(); }} />

<svelte:head>
	<title>HUE Workspace</title>
	<meta name="description" content="Projects, Workflows, and reliable Hermes Sessions." />
</svelte:head>

<Workspace
	projects={data.projects}
	chatSessionCount={data.chatSessionCount}
	chatIndicators={data.chatIndicators}
	cronSessionCount={data.cronSessionCount}
	projectsCapability={data.projectsCapability}
	projectsError={data.projectsError}
	reconciliationIssues={data.reconciliationIssues}
	projectReconciliation={data.projectReconciliation}
/>
{#if $settingsStatus.error}
	<div role="alert" class="fixed bottom-3 left-3 right-3 z-[100] rounded-lg border border-destructive bg-background p-3 text-sm">
		Settings were not saved or loaded: {$settingsStatus.error} <code>{$settingsStatus.path}</code>
		<button class="min-h-11 px-3 underline" onclick={refreshSettings}>Retry</button>
	</div>
{/if}
{#if $settingsStatus.pending}<span data-settings-pending role="status" class="fixed right-3 bottom-3 z-50 rounded-md border border-border bg-background px-3 py-2 text-xs">Saving settings…</span>{/if}
