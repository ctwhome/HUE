<script lang="ts">
	import { ArrowUp, Check, Diamond, Ellipsis, Folder, FolderPlus, Plus, X } from 'lucide-svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
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
		editingProject,
		projectRoot,
		projectDirectories,
		projectDirectoryParent,
		showHiddenDirectories,
		directoryLoading,
		directoryError,
		projectName = $bindable(),
		projectIcon = $bindable(),
		projectEmojiPickerOpen = $bindable(),
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
		editProjectDialog?: HTMLDialogElement;
		removeProjectDialog?: HTMLDialogElement;
		editingProject: Project | null;
		projectRoot: string;
		projectDirectories: Directory[];
		projectDirectoryParent: string | null;
		showHiddenDirectories: boolean;
		directoryLoading: boolean;
		directoryError: string;
		projectName: string;
		projectIcon: string | null;
		projectEmojiPickerOpen: boolean;
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
		onhidden: (event: Event) => void;
		ondirectory: (path?: string) => void;
		ontogglefolder: (path?: string) => void;
		onprimarychoice: (path: string) => void;
		oncreate: (event: SubmitEvent) => void;
		onaddfolder: () => void;
		onimage: (event: Event) => void;
		onsavemetadata: (event: SubmitEvent) => void;
		onsetprimary: (project: Project, path: string) => void;
		onremovefolder: (project: Project, path: string) => void;
		onlabel: (project: Project, path: string, label: string) => void;
		onarchiveRequest: () => void;
		onarchive: () => void;
		isImage: (icon: string | null) => boolean;
	} = $props();

	const currentFolderSelected = $derived(selectedFolders.includes(projectRoot));
	const addDisabled = $derived(projectsCapability !== 'available');
</script>

<aside
	bind:this={element}
	id="project-drawer"
	class="project-rail flex min-h-dvh flex-col gap-5 border-r border-border bg-card/95 px-3.5 py-5"
	class:open
	inert={mobile && !open}
	aria-hidden={mobile ? !open : undefined}
	aria-label="Projects"
>
	<header class="brand flex items-center gap-2.5 px-1.5">
		<span
			class="brand-mark grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-violet-700 font-black text-violet-950 shadow-lg"
			>H</span
		>
		<div><strong>HUE</strong><small>Hermes workspace</small></div>
		<button
			class="icon-button workspace-session-add ml-auto grid size-11 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="New session without a project"
			title="New session without a project"
			onclick={onprojectless}><Plus size={18} aria-hidden="true" /></button
		>
	</header>

	<div class="section-heading flex items-center justify-between">
		<span
			class="section-label px-2 text-[0.65rem] tracking-[0.15em] text-muted-foreground uppercase"
			>Projects</span
		>
		<button
			class="icon-button grid size-11 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
		<div class="project-row relative">
			<button
				class="project-select flex min-h-11 w-full items-center gap-2 rounded-lg bg-transparent px-2.5 py-2 pr-10 text-left text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
				class:active={!selectedProject}
				title="Open sessions with no project"
				onclick={() => onchoose(null)}
			>
				<Diamond
					class="project-icon grid size-6 shrink-0 place-items-center rounded-md"
					size={18}
					aria-hidden="true"
				/>
				<span>No project</span>
			</button>
		</div>
		{#each projects as project (project.id)}
			<div class="project-row group relative">
				<button
					class="project-select flex min-h-11 w-full items-center gap-2 rounded-lg bg-transparent px-2.5 py-2 pr-10 text-left text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
					class:active={selectedProject?.id === project.id}
					title={`Open ${project.name} · ${project.primaryPath}`}
					onclick={() => onchoose(project)}
				>
					{#if isImage(project.icon)}
						<img
							class="project-icon project-icon-image size-6 shrink-0 rounded-md object-cover"
							src={project.icon ?? ''}
							alt=""
						/>
					{:else if project.icon}
						<span class="project-icon grid size-6 shrink-0 place-items-center rounded-md"
							>{project.icon}</span
						>
					{:else}
						<span
							class="project-dot size-2 shrink-0 rounded-full bg-muted-foreground [.active_&]:bg-violet-400"
						></span>
					{/if}
					<span class="min-w-0 truncate">{project.name}</span>
					{#if !project.rootAvailable}<small class="text-amber-400">Missing</small>{/if}
				</button>
				<button
					class="project-edit absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent focus:opacity-100"
					aria-label={`Edit ${project.name}`}
					title={`Edit ${project.name}`}
					onclick={(event) => onedit(event, project)}
					><Ellipsis size={16} aria-hidden="true" /></button
				>
			</div>
		{/each}
	</nav>

	<dialog
		bind:this={addProjectDialog}
		class="add-project-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
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
			class="directory-browser min-h-56 overflow-auto rounded-xl border border-border bg-background p-2"
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
			<form class="mt-3 grid gap-3" onsubmit={oncreate}>
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
				<label class="grid gap-1"
					><span>Project name</span><input
						class="min-h-11"
						bind:value={projectName}
						required
					/></label
				>
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

	<dialog
		bind:this={editProjectDialog}
		class="add-project-dialog edit-project-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="edit-project-title"
		onclick={(event) => event.target === event.currentTarget && editProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="edit-project-title">Edit Hermes Project</h2>
				<p>Hermes owns identity and folders. HUE keeps linked workflow and delivery metadata.</p>
			</div>
		</header>
		<form class="grid gap-4" onsubmit={onsavemetadata}>
			<fieldset class="project-icon-field m-0 min-w-0 border-0 p-0">
				<legend>Project icon</legend>
				<div
					class="project-icon-editor mt-2 grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3"
				>
					<div
						class="project-icon-preview grid size-[58px] place-items-center overflow-hidden rounded-xl border border-border bg-background text-3xl"
					>
						{#if isImage(projectIcon)}<img
								src={projectIcon ?? ''}
								alt="Project icon preview"
							/>{:else}<span>{projectIcon || '•'}</span>{/if}
					</div>
					<div class="project-icon-options grid gap-2">
						<div class="project-icon-upload flex flex-wrap gap-1.5">
							<button
								type="button"
								class="min-h-11"
								aria-label="Choose project emoji"
								onclick={() => (projectEmojiPickerOpen = !projectEmojiPickerOpen)}
								>Choose emoji</button
							>
							<label class="min-h-11" title="Choose custom image"
								><span>Choose image</span><input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp"
									aria-label="Project icon image"
									onchange={onimage}
								/></label
							>
							<button type="button" class="min-h-11" onclick={() => (projectIcon = null)}
								>Default</button
							>
						</div>
					</div>
				</div>
				{#if projectEmojiPickerOpen}<EmojiPicker
						onselect={(emoji) => {
							projectIcon = emoji;
							projectEmojiPickerOpen = false;
						}}
					/>{/if}
			</fieldset>
			<label class="grid gap-1"
				><span>Project name</span><input
					class="min-h-11"
					bind:value={projectName}
					required
				/></label
			>
			<button
				type="submit"
				class="min-h-11 justify-self-end"
				disabled={projectSaving || !projectName.trim()}>Save name and icon</button
			>
		</form>

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
		<div class="mt-5 flex justify-between gap-3">
			<button
				type="button"
				class="min-h-11 text-destructive"
				disabled={projectSaving}
				onclick={onarchiveRequest}>Archive Project</button
			>
			<button type="button" class="min-h-11" onclick={() => editProjectDialog?.close()}>Done</button
			>
		</div>
		<button
			class="icon-button absolute top-3 right-3 grid size-11 place-items-center rounded-md"
			aria-label="Close edit Project"
			title="Close"
			onclick={() => editProjectDialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</dialog>

	<dialog
		bind:this={removeProjectDialog}
		class="add-project-dialog confirmation-dialog fixed top-1/2 left-1/2 m-0 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
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
