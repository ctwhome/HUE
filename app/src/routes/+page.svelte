<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshSettings, settingsStatus } from '$lib/settings-client';
	import Workspace from '$lib/components/Workspace.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let ready = $state(false);
	onMount(() => {
		void refreshSettings().then(() => (ready = true));
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

{#if ready}<Workspace
	projects={data.projects}
	chatSessionCount={data.chatSessionCount}
	chatIndicators={data.chatIndicators}
	cronSessionCount={data.cronSessionCount}
	projectsCapability={data.projectsCapability}
	projectsError={data.projectsError}
	reconciliationIssues={data.reconciliationIssues}
	projectReconciliation={data.projectReconciliation}
/>{/if}
{#if $settingsStatus.error}
	<div role="alert" class="fixed bottom-3 left-3 right-3 z-[100] rounded-lg border border-destructive bg-background p-3 text-sm">
		Settings were not saved or loaded: {$settingsStatus.error} <code>{$settingsStatus.path}</code>
		<button class="min-h-11 px-3 underline" onclick={refreshSettings}>Retry</button>
	</div>
{/if}
