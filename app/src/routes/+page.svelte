<script lang="ts">
	import Workspace from '$lib/components/Workspace.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>HUE Workspace</title>
	<meta name="description" content="Projects, Workflows, and reliable Hermes Sessions." />
</svelte:head>

{#await data.projectReconciliation}
	<Workspace
		projects={data.projects}
		chatSessionCount={data.chatSessionCount}
		chatIndicators={data.chatIndicators}
		cronSessionCount={data.cronSessionCount}
		projectsCapability={data.projectsCapability}
		projectsError={data.projectsError}
		reconciliationIssues={data.reconciliationIssues}
	/>
{:then reconciled}
	<Workspace
		projects={reconciled.projects}
		chatSessionCount={reconciled.chatSessionCount}
		chatIndicators={reconciled.chatIndicators}
		cronSessionCount={reconciled.cronSessionCount}
		projectsCapability={reconciled.projectsCapability}
		projectsError={reconciled.projectsError}
		reconciliationIssues={reconciled.reconciliationIssues}
	/>
{/await}
