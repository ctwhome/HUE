<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { Code2, Files } from 'lucide-svelte';
	import BrowserPanel from './workbench/BrowserPanel.svelte';
	import FilesPanel from './workbench/FilesPanel.svelte';
	import HealthStrip from './workbench/HealthStrip.svelte';
	import { afterInitialPaint } from './workbench/after-initial-paint';
	import type { DirtyGuard } from './workspace/dirty-guard';

	type TerminalProps = { projectId: string };
	type RepositoryProps = {
		projectId: string;
		onbranch: (branch: string | null) => void;
		onopenfile: (path: string) => void;
	};

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
	let TerminalPanel = $state<Component<TerminalProps> | null>(null);
	let RepositoryPanels = $state<Component<RepositoryProps> | null>(null);
	let terminalLoading = $state(false);
	let terminalError = $state('');
	let repositoryError = $state('');
	let mounted = false;
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	async function activateTerminal() {
		if (terminalLoading || TerminalPanel) return;
		terminalLoading = true;
		terminalError = '';
		try {
			const module = await import('./workbench/TerminalPanel.svelte');
			if (mounted) TerminalPanel = module.default;
		} catch (cause) {
			if (mounted) terminalError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (mounted) terminalLoading = false;
		}
	}
	async function loadRepositoryPanels() {
		try {
			const module = await import('./workbench/RepositoryPanels.svelte');
			if (mounted) RepositoryPanels = module.default;
		} catch (cause) {
			if (mounted) repositoryError = cause instanceof Error ? cause.message : String(cause);
		}
	}
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

	onMount(() => {
		mounted = true;
		const cancelRepositoryLoad = afterInitialPaint(() => void loadRepositoryPanels());
		return () => {
			mounted = false;
			cancelRepositoryLoad();
		};
	});
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
			{#if TerminalPanel}
				<TerminalPanel {projectId} />
			{:else}
				<article
					class={`${panel} terminal-panel grid place-content-center gap-3 p-4 text-center`}
					aria-label="Project terminal"
				>
					<strong class="text-sm">Terminal</strong>
					<span class="text-xs text-muted-foreground">Start when needed.</span>
					<button
						class="min-h-11 rounded-md border border-border px-4 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
						disabled={terminalLoading}
						onclick={activateTerminal}
						>{terminalLoading ? 'Starting terminal…' : 'Start terminal'}</button
					>
					{#if terminalError}<span class="text-xs text-destructive" role="alert"
							>{terminalError}</span
						>{/if}
				</article>
			{/if}
			{#if RepositoryPanels}
				<RepositoryPanels {projectId} {onbranch} onopenfile={openFile} />
			{:else}
				<article
					class={`${panel} repository-panel`}
					aria-label="Git status"
					aria-busy={!repositoryError}
				>
					<header class="min-h-11 border-b border-border bg-muted/40 px-2.5 py-2">
						<strong class="text-xs">Git</strong>
					</header>
					<div class="grid flex-1 place-content-center p-4 text-xs text-muted-foreground">
						{repositoryError ? 'Git unavailable' : 'Loading Git status'}
					</div>
					{#if repositoryError}<span class="px-4 pb-4 text-xs text-destructive" role="alert"
							>{repositoryError}</span
						>{/if}
				</article>
				<article
					class={`${panel} worktrees-panel`}
					aria-label="Git worktrees"
					aria-busy={!repositoryError}
				>
					<header class="min-h-11 border-b border-border bg-muted/40 px-2.5 py-2">
						<strong class="text-xs">Worktrees</strong>
					</header>
					<div class="grid flex-1 place-content-center p-4 text-xs text-muted-foreground">
						{repositoryError ? 'Git unavailable' : 'Loading Git worktrees'}
					</div>
				</article>
			{/if}
		</div>
	</div>
</section>
