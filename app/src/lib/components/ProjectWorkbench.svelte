<script lang="ts">
	import BrowserPanel from './workbench/BrowserPanel.svelte';
	import RepositoryPanels from './workbench/RepositoryPanels.svelte';
	import TerminalPanel from './workbench/TerminalPanel.svelte';

	let {
		projectId,
		projectName,
		onbranch
	}: { projectId: string; projectName: string; onbranch: (branch: string | null) => void } =
		$props();
</script>

<section
	class="project-workbench grid min-h-0 min-w-0 flex-1 gap-2.5 bg-background p-2.5"
	aria-label={`${projectName} workbench`}
>
	<BrowserPanel {projectId} />
	<TerminalPanel {projectId} />
	<RepositoryPanels {projectId} {onbranch} />
</section>
