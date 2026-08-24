<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import {
		Code2,
		Files,
		GitBranch,
		Globe,
		PanelRightClose,
		PanelRightOpen,
		TerminalSquare
	} from 'lucide-svelte';
	import BrowserPanel from './workbench/BrowserPanel.svelte';
	import FilesPanel from './workbench/FilesPanel.svelte';
	import { afterInitialPaint } from './workbench/after-initial-paint';
	import { api } from './workbench/api';
	import type { DirtyGuard } from './workspace/dirty-guard';

	type TerminalProps = { projectId: string };
	type RepositoryProps = {
		projectId: string;
		onbranch: (branch: string | null) => void;
		onopenfile: (path: string) => void;
		onchanges: (count: number) => void;
	};

	let {
		projectId,
		projectName,
		compact,
		docked = false,
		browserOpen = false,
		terminalOpen = false,
		onbrowser = () => {},
		onterminal = () => {},
		onpreviewchange = () => {},
		onbranch,
		dirtyGuard
	}: {
		projectId: string;
		projectName: string;
		compact: boolean;
		docked?: boolean;
		browserOpen?: boolean;
		terminalOpen?: boolean;
		onbrowser?: () => void;
		onterminal?: () => void;
		onpreviewchange?: (url: string) => void;
		onbranch: (branch: string | null) => void;
		dirtyGuard: DirtyGuard;
	} = $props();
	type Tool = 'git' | 'files';
	let view = $state<'develop' | 'files'>('develop');
	let developView = $state<'browser' | 'terminal' | 'git'>('browser');
	let open = $state(true);
	let gitChanges = $state(0);
	let width = $state(440);
	let maxWidth = $state(720);
	let activeTool = $derived<Tool | 'browser'>(
		view === 'files' ? 'files' : developView === 'git' ? 'git' : 'browser'
	);
	let dockElement: HTMLElement;
	let resizeStart: { x: number; width: number } | null = null;
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
	const tools = [
		{ id: 'git', label: 'Git', icon: GitBranch },
		{ id: 'files', label: 'Files', icon: Files }
	] as const;

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
	async function loadGitChangeCount() {
		try {
			gitChanges = (await api<{ changes: unknown[] }>(`/api/projects/${projectId}/repository`))
				.changes.length;
		} catch {
			gitChanges = 0;
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
	function chooseDevelopView(next: 'browser' | 'terminal' | 'git') {
		developView = next;
		if (next === 'terminal') void activateTerminal();
		if (next === 'git') void loadRepositoryPanels();
	}
	function toggleTool(tool: Tool) {
		if (open && activeTool === tool) {
			open = false;
			if (docked) localStorage.setItem(`hue:project-tools:${projectId}:dock`, 'closed');
			return;
		}
		open = true;
		if (tool === 'files') openFiles();
		else {
			chooseDevelopView(tool);
			openDevelop();
		}
		if (docked) localStorage.setItem(`hue:project-tools:${projectId}:dock`, tool);
	}
	function toggleTerminal() {
		open = true;
		onterminal();
	}
	function resizeLimits() {
		const available = dockElement?.parentElement?.clientWidth ?? globalThis.innerWidth ?? 960;
		return { min: 280, max: Math.max(280, available - 320) };
	}
	function setWidth(next: number) {
		const { min, max } = resizeLimits();
		maxWidth = max;
		width = Math.min(max, Math.max(min, next));
	}
	function saveWidth() {
		localStorage.setItem(`hue:project-tools:${projectId}:width`, String(Math.round(width)));
	}
	function startResize(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		resizeStart = { x: event.clientX, width };
	}
	function resize(event: PointerEvent) {
		if (resizeStart) setWidth(resizeStart.width + resizeStart.x - event.clientX);
	}
	function finishResize() {
		if (!resizeStart) return;
		resizeStart = null;
		saveWidth();
	}
	function resizeWithKeyboard(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const { min, max } = resizeLimits();
		setWidth(
			event.key === 'Home'
				? min
				: event.key === 'End'
					? max
					: width + (event.key === 'ArrowLeft' ? 24 : -24)
		);
		saveWidth();
	}

	onMount(() => {
		mounted = true;
		if (docked) {
			open = false;
			const savedWidth = Number(localStorage.getItem(`hue:project-tools:${projectId}:width`));
			setWidth(
				savedWidth > 0 ? savedWidth : (dockElement.parentElement?.clientWidth ?? 960) * 0.46
			);
			const savedDock = localStorage.getItem(`hue:project-tools:${projectId}:dock`);
			if (savedDock === 'files') {
				open = true;
				openFiles();
			} else if (savedDock === 'git') {
				open = true;
				chooseDevelopView('git');
			}
		}
		const cancelRepositoryLoad = afterInitialPaint(() => {
			void loadRepositoryPanels();
			void loadGitChangeCount();
		});
		return () => {
			mounted = false;
			cancelRepositoryLoad();
		};
	});
</script>

<div
	bind:this={dockElement}
	class="project-tool-dock flex min-h-0 min-w-0"
	class:docked
	class:open={!docked || open}
	style={`--project-tool-width: ${width}px`}
>
	{#if docked && open}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
		<div
			class="project-tool-resizer"
			role="separator"
			aria-label="Resize project tools"
			aria-orientation="vertical"
			aria-valuemin="280"
			aria-valuemax={maxWidth}
			aria-valuenow={Math.round(width)}
			tabindex="0"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
			onkeydown={resizeWithKeyboard}
		></div>
	{/if}
	<section
		class="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
		aria-label={`${projectName} workbench`}
		aria-hidden={docked && !open}
		inert={docked && !open ? true : undefined}
	>
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
				class:compact={compact || docked}
				class:invisible={view !== 'develop'}
				class:pointer-events-none={view !== 'develop'}
				aria-hidden={view !== 'develop'}
			>
				{#if compact}<nav class="compact-workbench-tabs" aria-label="Project tools">
						<button
							aria-pressed={developView === 'browser'}
							onclick={() => chooseDevelopView('browser')}
							><Globe size={17} aria-hidden="true" />Browser</button
						><button
							aria-pressed={developView === 'terminal'}
							onclick={() => chooseDevelopView('terminal')}
							><TerminalSquare size={17} aria-hidden="true" />Terminal</button
						><button aria-pressed={developView === 'git'} onclick={() => chooseDevelopView('git')}
							><GitBranch size={17} aria-hidden="true" />Git</button
						>
					</nav>{/if}
				{#if !docked && (!compact || developView === 'browser')}<BrowserPanel
						{projectId}
						{onpreviewchange}
					/>{/if}
				{#if (!compact && !docked) || developView === 'terminal'}
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
				{/if}
				{#if (!compact && !docked) || developView === 'git'}
					{#if RepositoryPanels}
						<RepositoryPanels
							{projectId}
							{onbranch}
							onopenfile={openFile}
							onchanges={(count) => (gitChanges = count)}
						/>
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
				{/if}
			</div>
		</div>
	</section>
	{#if docked}<nav class="project-tool-rail" aria-label="Project tools">
			<button
				type="button"
				class:active={browserOpen}
				aria-label={browserOpen ? 'Hide Browser' : 'Show Browser'}
				aria-expanded={browserOpen}
				title={browserOpen ? 'Hide Browser' : 'Show Browser'}
				onclick={onbrowser}
			>
				{#if browserOpen}<PanelRightClose size={19} aria-hidden="true" />{:else}<PanelRightOpen
						size={19}
						aria-hidden="true"
					/>{/if}
			</button>
			{#each tools as tool}
				{@const Icon = tool.icon}
				<button
					type="button"
					class:active={open && activeTool === tool.id}
					aria-label={tool.id === 'git' && gitChanges
						? `Git, ${gitChanges} changed files`
						: tool.label}
					aria-expanded={open && activeTool === tool.id}
					title={`${open && activeTool === tool.id ? 'Hide' : 'Show'} ${tool.label}`}
					onclick={() => toggleTool(tool.id)}
				>
					<Icon size={19} aria-hidden="true" />
					{#if tool.id === 'git' && gitChanges}<span class="git-change-badge">{gitChanges}</span
						>{/if}
				</button>
			{/each}
			<button
				type="button"
				class="terminal-tool"
				class:active={terminalOpen}
				aria-label="Terminal"
				aria-expanded={terminalOpen}
				title={`${terminalOpen ? 'Hide' : 'Show'} Terminal`}
				onclick={toggleTerminal}
			>
				<TerminalSquare size={19} aria-hidden="true" />
			</button>
		</nav>{/if}
</div>
