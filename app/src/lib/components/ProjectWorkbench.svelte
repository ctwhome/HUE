<script lang="ts">
	import { Code2, Files } from 'lucide-svelte';
	import BrowserPanel from './workbench/BrowserPanel.svelte';
	import FilesPanel from './workbench/FilesPanel.svelte';
	import RepositoryPanels from './workbench/RepositoryPanels.svelte';
	import TerminalPanel from './workbench/TerminalPanel.svelte';
	import HealthStrip from './workbench/HealthStrip.svelte';
	import type { DirtyGuard } from './workspace/dirty-guard';

	let {
		projectId,
		projectName,
		onbranch,
		dirtyGuard
	}: {
		projectId: string;
		projectName: string;
		onbranch: (branch: string | null) => void;
		dirtyGuard: DirtyGuard;
	} = $props();
	let previewUrl = $state('');
	let view = $state<'develop' | 'files'>('develop');
	let filesMounted = $state(false);
	let fileRequest = $state<{ path: string; id: string } | null>(null);
	function openFile(path: string) {
		filesMounted = true;
		fileRequest = { path, id: crypto.randomUUID() };
		view = 'files';
	}
	function openFiles() {
		filesMounted = true;
		view = 'files';
	}
	function openDevelop() {
		if (!dirtyGuard.block(() => (view = 'develop'))) view = 'develop';
	}
</script>

<section
	class="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
	aria-label={`${projectName} workbench`}
>
	<HealthStrip {projectId} {previewUrl} />
	<nav
		class="workbench-tabs flex gap-1 border-b border-border px-2.5 py-1.5"
		aria-label="Project workbench views"
	>
		<button
			class="flex min-h-9 items-center gap-2 rounded-md px-3 text-xs"
			class:bg-secondary={view === 'develop'}
			aria-pressed={view === 'develop'}
			onclick={openDevelop}><Code2 size={15} aria-hidden="true" />Develop</button
		>
		<button
			class="flex min-h-9 items-center gap-2 rounded-md px-3 text-xs"
			class:bg-secondary={view === 'files'}
			aria-pressed={view === 'files'}
			onclick={openFiles}><Files size={15} aria-hidden="true" />Files</button
		>
	</nav>
	<div class="relative min-h-0 flex-1">
		{#if filesMounted}<div
				class="absolute inset-0 p-2.5"
				class:invisible={view !== 'files'}
				class:pointer-events-none={view !== 'files'}
				aria-hidden={view !== 'files'}
			>
				<FilesPanel {projectId} {fileRequest} {dirtyGuard} />
			</div>{/if}
		<div
			class="project-workbench absolute inset-0 grid min-h-0 min-w-0 gap-2.5 p-2.5"
			class:invisible={view !== 'develop'}
			class:pointer-events-none={view !== 'develop'}
			aria-hidden={view !== 'develop'}
		>
			<BrowserPanel {projectId} onpreviewchange={(url) => (previewUrl = url)} />
			<TerminalPanel {projectId} />
			<RepositoryPanels {projectId} {onbranch} onopenfile={openFile} />
		</div>
	</div>
</section>
