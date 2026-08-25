<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Archive,
		ArrowUp,
		Check,
		ChevronRight,
		Diamond,
		Ellipsis,
		Folder,
		FolderPlus,
		Plus,
		X
	} from 'lucide-svelte';
	import IconEditorPopover from '$lib/components/IconEditorPopover.svelte';
	import ProjectFoldersEditor from './ProjectFoldersEditor.svelte';
	import type { Directory, Project } from './types';

	let {
		element = $bindable(),
		open,
		mobile,
		projects,
		selectedProject,
		projectsCapability,
		projectsError,
		reconciliationIssues,
		addProjectDialog = $bindable(),
		editProjectDialog = $bindable(),
		removeProjectDialog = $bindable(),
		projectIconPopover = $bindable(),
		projectSettingsIconPopover = $bindable(),
		projectIconAnchor,
		editingProject,
		projectRoot,
		projectDirectories,
		projectDirectoryParent,
		showHiddenDirectories,
		directoryLoading,
		directoryError,
		projectName = $bindable(),
		projectIcon = $bindable(),
		projectColor = $bindable(),
		projectGroup = $bindable(),
		projectEditError,
		projectSaving,
		locatingProject,
		selectedFolders,
		primaryFolder,
		onprojectless,
		onaddopen,
		onchoose,
		onlocate,
		onedit,
		onicon,
		oniconselect,
		oncolor,
		ongroup,
		onhidden,
		ondirectory,
		ontogglefolder,
		onprimarychoice,
		oncreate,
		onaddfolder,
		onimage,
		onsavemetadata,
		onsetprimary,
		onremovefolder,
		onlabel,
		onarchiveRequest,
		onarchive,
		onclose,
		isImage
	}: {
		element?: HTMLElement;
		open: boolean;
		mobile: boolean;
		projects: Project[];
		selectedProject: Project | null;
		projectsCapability: 'available' | 'unavailable' | 'outage';
		projectsError: string;
		reconciliationIssues: Array<{ legacyProjectId: string; kind: string; message: string }>;
		addProjectDialog?: HTMLDialogElement;
		editProjectDialog?: HTMLElement;
		removeProjectDialog?: HTMLDialogElement;
		projectIconPopover?: HTMLElement;
		projectSettingsIconPopover?: HTMLElement;
		projectIconAnchor?: HTMLElement;
		editingProject: Project | null;
		projectRoot: string;
		projectDirectories: Directory[];
		projectDirectoryParent: string | null;
		showHiddenDirectories: boolean;
		directoryLoading: boolean;
		directoryError: string;
		projectName: string;
		projectIcon: string | null;
		projectColor: string;
		projectGroup: string;
		projectEditError: string;
		projectSaving: boolean;
		locatingProject: Project | null;
		selectedFolders: string[];
		primaryFolder: string;
		onprojectless: () => void;
		onaddopen: () => void;
		onchoose: (project: Project | null) => void;
		onlocate: (project: Project) => void;
		onedit: (event: MouseEvent, project: Project) => void;
		onicon: (event: MouseEvent, project: Project) => void;
		oniconselect: (icon: string | null) => void;
		oncolor: (color: string) => void;
		ongroup: (group: string) => void;
		onhidden: (event: Event) => void;
		ondirectory: (path?: string) => void;
		ontogglefolder: (path?: string) => void;
		onprimarychoice: (path: string) => void;
		oncreate: (event: SubmitEvent) => void;
		onaddfolder: () => void;
		onimage: (event: Event) => void;
		onsavemetadata: () => void;
		onsetprimary: (project: Project, path: string) => void;
		onremovefolder: (project: Project, path: string) => void;
		onlabel: (project: Project, path: string, label: string) => void;
		onarchiveRequest: () => void;
		onarchive: () => void;
		onclose: () => void;
		isImage: (icon: string | null) => boolean;
	} = $props();

	const currentFolderSelected = $derived(selectedFolders.includes(projectRoot));
	const addDisabled = $derived(projectsCapability !== 'available');
	const projectGroups = $derived.by(() => {
		const groups = new Map<string | null, Project[]>();
		for (const project of projects) {
			const label = project.group;
			groups.set(label, [...(groups.get(label) ?? []), project]);
		}
		return [...groups].map(([label, items]) => ({ label, projects: items }));
	});
	const groupLabels = $derived(
		projectGroups.flatMap((group) => (group.label ? [group.label] : []))
	);
	let collapsedGroups = $state(new Set<string>());

	onMount(() => {
		try {
			collapsedGroups = new Set(
				JSON.parse(localStorage.getItem('hue:project-groups:collapsed') ?? '[]')
			);
		} catch {
			collapsedGroups = new Set();
		}
	});

	function toggleGroup(label: string) {
		const next = new Set(collapsedGroups);
		if (next.has(label)) next.delete(label);
		else next.add(label);
		collapsedGroups = next;
		localStorage.setItem('hue:project-groups:collapsed', JSON.stringify([...next]));
	}
</script>

<aside
	bind:this={element}
	id="project-drawer"
	class="project-rail flex min-h-dvh flex-col gap-3 border-r border-border bg-card/95 px-2 py-3"
	class:open
	inert={mobile && !open}
	aria-hidden={mobile ? !open : undefined}
	aria-label="Projects"
>
	{#if mobile}<button
			class="drawer-close grid size-11 place-items-center rounded-md"
			aria-label="Close Projects"
			title="Close Projects"
			onclick={onclose}><X size={20} aria-hidden="true" /></button
		>{/if}
	<div class="section-heading flex items-center justify-between">
		<span
			class="section-label px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
			>Projects</span
		>
		<button
			class="icon-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Add Hermes Project"
			title={addDisabled ? projectsError : 'Add Hermes Project'}
			disabled={addDisabled}
			onclick={onaddopen}><Plus size={18} aria-hidden="true" /></button
		>
	</div>

	{#if projectsCapability !== 'available'}
		<p
			class="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200"
			role="status"
		>
			<strong
				>{projectsCapability === 'unavailable' ? 'Projects unavailable' : 'Hermes offline'}</strong
			>
			<span class="mt-1 block">{projectsError}</span>
		</p>
	{/if}
	{#if reconciliationIssues.length}
		<div
			class="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200"
			role="alert"
		>
			<strong>Legacy Projects need review</strong>
			{#each reconciliationIssues as issue (issue.legacyProjectId)}
				<span class="mt-1 block">{issue.message}</span>
			{/each}
		</div>
	{/if}

	<nav>
		<div class="project-row projectless-row relative">
			<button
				class="project-select flex min-h-(--control-height) w-full items-center gap-2 rounded-md bg-transparent px-2 py-1 pr-8 text-left text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
				class:active={!selectedProject}
				aria-current={!selectedProject ? 'page' : undefined}
				onclick={() => onchoose(null)}
			>
				<Diamond
					class="project-icon grid size-(--navigation-icon-size) shrink-0 place-items-center rounded-md"
					size={18}
					aria-hidden="true"
				/>
				<span>No project</span>
			</button>
			<button
				class="icon-button workspace-session-add absolute top-1/2 right-0 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="New session without a project"
				title="New session without a project"
				onclick={onprojectless}><Plus size={18} aria-hidden="true" /></button
			>
		</div>
		{#each projectGroups as group (group.label ?? '')}
			{#if group.label}<button
					class="mt-2 flex min-h-11 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					aria-expanded={!collapsedGroups.has(group.label)}
					title={group.label}
					onclick={() => toggleGroup(group.label!)}
				>
					<ChevronRight
						class={`shrink-0 transition-transform ${collapsedGroups.has(group.label) ? '' : 'rotate-90'}`}
						size={14}
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1 truncate">{group.label}</span>
					<span aria-label={`${group.projects.length} projects`}>{group.projects.length}</span>
				</button>{/if}
			{#if !group.label || !collapsedGroups.has(group.label)}
				{#each group.projects as project (project.id)}
					<div class="project-row group relative">
						<button
							class="project-icon-trigger absolute top-1/2 left-0 z-1 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md hover:bg-accent"
							aria-label={`Change ${project.name} icon`}
							title={`Change ${project.name} icon`}
							onclick={(event) => onicon(event, project)}
						>
							{#if isImage(project.icon)}<img
									class="project-icon project-icon-image size-(--navigation-icon-size) rounded-md object-cover"
									src={project.icon ?? ''}
									alt=""
								/>{:else if project.icon}<span
									class="project-icon grid size-(--navigation-icon-size) place-items-center rounded-md"
									>{project.icon}</span
								>{:else}<Folder
									class="project-icon project-icon-default size-(--navigation-icon-size) text-muted-foreground"
									size={18}
									aria-hidden="true"
								/>{/if}
						</button>
						<button
							class="project-select flex min-h-(--control-height) w-full items-center gap-2 rounded-md bg-transparent py-1 pr-8 pl-8 text-left text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
							class:active={selectedProject?.id === project.id}
							aria-current={selectedProject?.id === project.id ? 'page' : undefined}
							onclick={() => onchoose(project)}
						>
							{#if isImage(project.icon)}<img
									class="project-icon-inline project-icon-image size-(--navigation-icon-size) rounded-md object-cover"
									src={project.icon ?? ''}
									alt=""
								/>{:else if project.icon}<span
									class="project-icon-inline size-(--navigation-icon-size) place-items-center rounded-md"
									>{project.icon}</span
								>{:else}<Folder
									class="project-icon-inline project-icon-default size-(--navigation-icon-size) text-muted-foreground"
									size={18}
									aria-hidden="true"
								/>{/if}
							<span class="min-w-0 truncate">{project.name}</span>
							{#if !project.rootAvailable}<small class="text-amber-400">Missing</small>{/if}
						</button>
						<button
							class="project-edit absolute top-1/2 right-0 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent focus:opacity-100"
							aria-label={`Edit ${project.name}`}
							title={`Edit ${project.name}`}
							onclick={(event) => onedit(event, project)}
							><Ellipsis size={16} aria-hidden="true" /></button
						>
					</div>
				{/each}
			{/if}
		{/each}
	</nav>

	<dialog
		bind:this={addProjectDialog}
		class="add-project-dialog fixed m-0 max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="add-project-title"
		onclick={(event) => event.target === event.currentTarget && addProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="add-project-title">
					{locatingProject ? `Add folder to ${locatingProject.name}` : 'Create Hermes Project'}
				</h2>
				<p>
					{locatingProject
						? 'Choose one backend folder.'
						: 'Select one or more backend folders and exactly one primary.'}
				</p>
			</div>
			<label class="min-h-11"
				><input type="checkbox" checked={showHiddenDirectories} onchange={onhidden} /> Show hidden</label
			>
		</header>
		{#if !locatingProject}
			<label class="mb-3 grid gap-1"
				><span>Project name</span><input
					class="min-h-11"
					form="create-project-form"
					bind:value={projectName}
					required
				/></label
			>
		{/if}
		<div class="directory-location mb-3 flex min-w-0 items-center gap-2.5">
			<button
				class="grid size-11 shrink-0 place-items-center"
				disabled={!projectDirectoryParent || directoryLoading}
				onclick={() => projectDirectoryParent && ondirectory(projectDirectoryParent)}
				aria-label="Parent directory"
				title="Parent directory"><ArrowUp size={16} aria-hidden="true" /></button
			>
			<code class="min-w-0 overflow-hidden text-ellipsis">{projectRoot || 'Loading…'}</code>
		</div>
		<section
			class="directory-browser max-h-80 min-h-56 overflow-auto rounded-xl border border-border bg-background p-2"
			aria-label="Directories"
		>
			<strong>Directories</strong>
			{#if directoryLoading}
				<p class="text-sm text-muted-foreground">Loading directories…</p>
			{:else if directoryError}
				<p class="text-sm text-destructive" role="alert">{directoryError}</p>
			{:else if projectDirectories.length === 0}
				<p class="text-sm text-muted-foreground">No subdirectories.</p>
			{:else}
				{#each projectDirectories as directory (directory.path)}
					<button
						class="directory-row grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
						title={`Open ${directory.name}`}
						onclick={() => ondirectory(directory.path)}
					>
						<Folder size={16} aria-hidden="true" /><span class="truncate">{directory.name}</span>
					</button>
				{/each}
			{/if}
		</section>

		{#if locatingProject}
			<div class="mt-3 flex justify-end">
				<button class="min-h-11" disabled={!projectRoot || projectSaving} onclick={onaddfolder}>
					<FolderPlus size={16} aria-hidden="true" /> Add this folder
				</button>
			</div>
		{:else}
			<form id="create-project-form" class="mt-3 grid gap-3" onsubmit={oncreate}>
				<button
					type="button"
					class="min-h-11"
					disabled={!projectRoot}
					onclick={() => ontogglefolder(projectRoot)}
				>
					{#if currentFolderSelected}<Check size={16} aria-hidden="true" /> Remove current folder{:else}<FolderPlus
							size={16}
							aria-hidden="true"
						/> Select current folder{/if}
				</button>
				<fieldset class="grid gap-2 rounded-lg border border-border p-3">
					<legend>Selected folders</legend>
					{#each selectedFolders as folder (folder)}
						<label class="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
							<input
								type="radio"
								name="primary-folder"
								value={folder}
								checked={primaryFolder === folder}
								onchange={() => onprimarychoice(folder)}
							/>
							<code class="min-w-0 overflow-hidden text-ellipsis">{folder}</code>
							<button
								type="button"
								class="grid size-11 place-items-center"
								aria-label={`Remove ${folder}`}
								title={`Remove ${folder}`}
								onclick={() => ontogglefolder(folder)}><X size={16} aria-hidden="true" /></button
							>
						</label>
					{:else}
						<p class="text-sm text-muted-foreground">No folders selected.</p>
					{/each}
					{#if selectedFolders.length}<small class="text-muted-foreground"
							>Selected radio is primary folder.</small
						>{/if}
				</fieldset>
				<button
					type="submit"
					class="min-h-11"
					disabled={projectSaving ||
						!projectName.trim() ||
						!selectedFolders.length ||
						!primaryFolder}>Create Project</button
				>
			</form>
		{/if}
		<button
			class="icon-button absolute top-3 right-3 grid size-11 place-items-center rounded-md"
			aria-label="Close Project folder browser"
			title="Close"
			onclick={() => addProjectDialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</dialog>

	<div
		bind:this={editProjectDialog}
		popover="auto"
		role="dialog"
		class="project-manager-popover fixed m-0 max-h-[min(680px,calc(100dvh-24px))] w-[min(380px,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-card p-2 text-foreground shadow-2xl"
		aria-labelledby="edit-project-title"
	>
		<header class="flex items-center gap-3 px-2 py-2">
			<button
				type="button"
				class="project-icon-preview grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-xl hover:ring-2 hover:ring-ring"
				aria-label="Change project icon"
				title="Change project icon"
				onclick={(event) => editingProject && onicon(event, editingProject)}
			>
				{#if isImage(projectIcon)}<img src={projectIcon ?? ''} alt="" />{:else if projectIcon}<span
						>{projectIcon}</span
					>{:else}<Folder class="text-muted-foreground" size={20} aria-hidden="true" />{/if}
			</button>
			<div class="min-w-0 flex-1">
				<h2 id="edit-project-title" class="truncate text-sm font-semibold">Project options</h2>
				<p class="text-xs text-muted-foreground">
					{projectSaving ? 'Saving...' : 'Saved automatically'}
				</p>
			</div>
			<button
				class="grid size-9 place-items-center rounded-lg hover:bg-accent"
				aria-label="Close project options"
				title="Close"
				onclick={() => editProjectDialog?.hidePopover()}><X size={17} aria-hidden="true" /></button
			>
		</header>
		<div class="grid gap-3 px-2 pb-2">
			<label class="grid gap-1.5 text-xs font-medium"
				>Name<input
					class="min-h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={projectName}
					maxlength="200"
					required
					onchange={onsavemetadata}
				/></label
			>
			<label
				class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-accent"
			>
				<span>Project status bar color</span>
				<input
					class="size-11 cursor-pointer rounded border-0 bg-transparent p-0"
					type="color"
					bind:value={projectColor}
					aria-label="Project status bar color"
					disabled={projectSaving}
					onchange={() => oncolor(projectColor)}
				/>
			</label>
			<label class="grid gap-1.5 text-xs font-medium"
				>Group label<input
					class="min-h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={projectGroup}
					list="project-group-labels"
					maxlength="100"
					placeholder="Ungrouped"
					onchange={() => ongroup(projectGroup)}
				/></label
			>
			<datalist id="project-group-labels">
				{#each groupLabels as label (label)}<option value={label}></option>{/each}
			</datalist>

			<ProjectFoldersEditor
				project={editingProject}
				saving={projectSaving}
				onadd={onlocate}
				{onsetprimary}
				onremove={onremovefolder}
				{onlabel}
			/>
			{#if projectEditError}<p class="mt-3 text-sm text-destructive" role="alert">
					{projectEditError}
				</p>{/if}
			<section class="grid gap-1 border-t border-border pt-2" aria-label="Project actions">
				<button
					type="button"
					class="session-menu-action text-destructive"
					disabled={projectSaving}
					onclick={onarchiveRequest}
					><Archive size={16} aria-hidden="true" /> Archive Project</button
				>
			</section>
		</div>
		<IconEditorPopover
			bind:popover={projectSettingsIconPopover}
			anchor={projectIconAnchor}
			label="Project"
			{onimage}
			onselect={oniconselect}
		/>
	</div>

	<IconEditorPopover
		bind:popover={projectIconPopover}
		anchor={projectIconAnchor}
		label="Project"
		{onimage}
		onselect={oniconselect}
	/>

	<dialog
		bind:this={removeProjectDialog}
		class="add-project-dialog confirmation-dialog fixed m-0 w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="archive-project-title"
		aria-describedby="archive-project-description"
		onclick={(event) => event.target === event.currentTarget && removeProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="archive-project-title">Archive Hermes Project?</h2>
				<p id="archive-project-description">
					Archive {editingProject?.name}? HUE workflow, session, delivery metadata, and Hermes
					transcripts remain stored.
				</p>
			</div>
		</header>
		{#if projectEditError}<p class="text-sm text-destructive" role="alert">
				{projectEditError}
			</p>{/if}
		<div class="confirmation-actions flex justify-end gap-2.5">
			<button type="button" class="min-h-11" onclick={() => removeProjectDialog?.close()}
				>Cancel</button
			>
			<button
				type="button"
				class="min-h-11 text-destructive"
				disabled={projectSaving}
				onclick={onarchive}>Archive Project</button
			>
		</div>
	</dialog>
</aside>
