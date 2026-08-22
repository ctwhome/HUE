<script lang="ts">
	import BrowserPanel from './workbench/BrowserPanel.svelte';
	import RepositoryPanels from './workbench/RepositoryPanels.svelte';
	import TerminalPanel from './workbench/TerminalPanel.svelte';
	import HealthStrip from './workbench/HealthStrip.svelte';

	let {
		projectId,
		projectName,
		onbranch
	}: { projectId: string; projectName: string; onbranch: (branch: string | null) => void } =
		$props();
	let previewUrl = $state('');
</script>

<section
	class="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
	aria-label={`${projectName} workbench`}
>
	<HealthStrip {projectId} {previewUrl} />
	<div class="project-workbench grid min-h-0 min-w-0 flex-1 gap-2.5 p-2.5">
		<BrowserPanel {projectId} onpreviewchange={(url) => (previewUrl = url)} />
		<TerminalPanel {projectId} />
		<RepositoryPanels {projectId} {onbranch} />
	</div>
</section>
