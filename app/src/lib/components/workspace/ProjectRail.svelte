<script lang="ts">
	import { ArrowUp, Diamond, Ellipsis, Folder, Plus, X } from 'lucide-svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	type Project = {
		id: string;
		name: string;
		rootPath: string;
		icon: string | null;
		createdAt: string;
	};
	type Directory = { name: string; path: string };
	let {
		open,
		projects,
		selectedProject,
		addProjectDialog = $bindable(),
		editProjectDialog = $bindable(),
		removeProjectDialog = $bindable(),
		editingProject,
		projectRoot,
		projectDirectoryName,
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
		onprojectless,
		onaddopen,
		onchoose,
		onedit,
		onhidden,
		ondirectory,
		onadd,
		onimage,
		onsave,
		onremoveRequest,
		onremove,
		isImage
	}: {
		open: boolean;
		projects: Project[];
		selectedProject: Project | null;
		addProjectDialog?: HTMLDialogElement;
		editProjectDialog?: HTMLDialogElement;
		removeProjectDialog?: HTMLDialogElement;
		editingProject: Project | null;
		projectRoot: string;
		projectDirectoryName: string;
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
		onprojectless: () => void;
		onaddopen: () => void;
		onchoose: (project: Project | null) => void;
		onedit: (event: MouseEvent, project: Project) => void;
		onhidden: (event: Event) => void;
		ondirectory: (path?: string) => void;
		onadd: (event: SubmitEvent) => void;
		onimage: (event: Event) => void;
		onsave: (event: SubmitEvent) => void;
		onremoveRequest: () => void;
		onremove: () => void;
		isImage: (icon: string | null) => boolean;
	} = $props();
</script>

<aside
	id="project-drawer"
	class="project-rail flex min-h-dvh flex-col gap-5 border-r border-border bg-card/95 px-3.5 py-5"
	class:open
	aria-label="Projects"
>
	<header class="brand flex items-center gap-2.5 px-1.5">
		<span
			class="brand-mark grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-violet-700 font-black text-violet-950 shadow-lg"
			>H</span
		>
		<div><strong>HUE</strong><small>Hermes workspace</small></div>
		<button
			class="icon-button workspace-session-add ml-auto grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
			class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Add project"
			title="Add project"
			onclick={onaddopen}><Plus size={18} aria-hidden="true" /></button
		>
	</div>
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
				/><span>No project</span>
			</button>
		</div>
		{#each projects as project}
			<div class="project-row relative">
				<button
					class="project-select flex min-h-11 w-full items-center gap-2 rounded-lg bg-transparent px-2.5 py-2 pr-10 text-left text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
					class:active={selectedProject?.id === project.id}
					title={`Open ${project.name}`}
					onclick={() => onchoose(project)}
				>
					{#if isImage(project.icon)}<img
							class="project-icon project-icon-image size-6 shrink-0 rounded-md object-cover"
							src={project.icon ?? ''}
							alt=""
						/>
					{:else if project.icon}<span
							class="project-icon grid size-6 shrink-0 place-items-center rounded-md"
							>{project.icon}</span
						>
					{:else}<span
							class="project-dot size-2 shrink-0 rounded-full bg-muted-foreground [.active_&]:bg-violet-400"
						></span>{/if}<span>{project.name}</span>
				</button>
				<button
					class="project-edit absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent [.project-row:focus-within_&]:opacity-100"
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
		class="add-project-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="add-project-title"
		onclick={(event) => event.target === event.currentTarget && addProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="add-project-title">Add project directory</h2>
				<p>Choose a folder to add as a project.</p>
			</div>
			<label>
				<input type="checkbox" checked={showHiddenDirectories} onchange={onhidden} />
				Show hidden
			</label>
		</header>
		<div class="directory-location mb-3 flex min-w-0 items-center gap-2.5">
			<button
				disabled={!projectDirectoryParent || directoryLoading}
				onclick={() => projectDirectoryParent && ondirectory(projectDirectoryParent)}
				aria-label="Parent directory"
				title="Parent directory"><ArrowUp size={16} aria-hidden="true" /></button
			>
			<code>{projectRoot || 'Loading…'}</code>
		</div>
		<section
			class="directory-browser min-h-56 overflow-auto rounded-xl border border-border bg-background p-2"
			aria-label="Directories"
		>
			<strong>Directories</strong>
			{#if directoryLoading}<p class="muted text-sm text-muted-foreground">Loading directories…</p>
			{:else if directoryError}<p class="directory-error text-sm text-destructive" role="alert">
					{directoryError}
				</p>
			{:else if projectDirectories.length === 0}<p class="muted text-sm text-muted-foreground">
					No subdirectories.
				</p>
			{:else}{#each projectDirectories as directory}
					<button
						class="directory-row grid min-h-9 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
						title={`Open ${directory.name}`}
						onclick={() => ondirectory(directory.path)}
					>
						<Folder size={16} aria-hidden="true" /><span>{directory.name}</span><small
							>{#if projects.some((project) => project.rootPath === directory.path)}Added{:else}<Plus
									size={13}
									aria-label="Available to add"
								/>{/if}</small
						>
					</button>
				{/each}{/if}
		</section>
		<form class="add-project mt-3 grid gap-2" onsubmit={onadd}>
			<button
				type="submit"
				title="Add this directory"
				disabled={directoryLoading ||
					!projectRoot ||
					projects.some((project) => project.rootPath === projectRoot)}
				>{projects.some((project) => project.rootPath === projectRoot)
					? 'Already added'
					: 'Add this directory'}</button
			>
		</form>
		<button
			class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Close add project"
			title="Close add project"
			onclick={() => addProjectDialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</dialog>
	<dialog
		bind:this={editProjectDialog}
		class="add-project-dialog edit-project-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="edit-project-title"
		onclick={(event) => event.target === event.currentTarget && editProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="edit-project-title">Edit project</h2>
				<p>Make this project easy to spot, rename it, or remove it from HUE.</p>
			</div>
		</header>
		<form onsubmit={onsave}>
			<fieldset class="project-icon-field m-0 min-w-0 border-0 p-0">
				<legend>Project icon</legend>
				<div
					class="project-icon-editor mt-2 grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3"
				>
					<div
						class="project-icon-preview grid size-[58px] place-items-center overflow-hidden rounded-xl border border-border bg-background text-3xl"
					>
						{#if isImage(projectIcon)}<img src={projectIcon ?? ''} alt="Project icon preview" />
						{:else}<span>{projectIcon || '•'}</span>{/if}
					</div>
					<div class="project-icon-options grid gap-2">
						<div class="project-icon-upload flex gap-1.5">
							<button
								type="button"
								aria-label="Choose project emoji"
								title="Choose project emoji"
								onclick={() => (projectEmojiPickerOpen = !projectEmojiPickerOpen)}
								>Choose emoji</button
							>
							<label title="Choose a custom image">
								<span>Choose image</span>
								<input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp"
									aria-label="Project icon image"
									onchange={onimage}
								/>
							</label>
							<button
								type="button"
								title="Use default project dot"
								onclick={() => (projectIcon = null)}>Default</button
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
			<label>
				<span>Project name</span>
				<input bind:value={projectName} aria-label="Project name" required />
			</label>
			<label>
				<span>Project directory</span>
				<input value={editingProject?.rootPath ?? ''} aria-label="Project directory" disabled />
			</label>
			{#if projectEditError}<p class="directory-error text-sm text-destructive" role="alert">
					{projectEditError}
				</p>{/if}
			<div class="edit-project-actions flex justify-between gap-3">
				<button
					type="button"
					class="danger-button text-destructive"
					title="Remove project"
					disabled={projectSaving}
					onclick={onremoveRequest}>Remove project</button
				>
				<button type="submit" title="Save changes" disabled={projectSaving || !projectName.trim()}
					>Save changes</button
				>
			</div>
		</form>
		<button
			class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Close edit project"
			title="Close edit project"
			onclick={() => editProjectDialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</dialog>
	<dialog
		bind:this={removeProjectDialog}
		class="add-project-dialog confirmation-dialog fixed top-1/2 left-1/2 m-0 w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="remove-project-title"
		aria-describedby="remove-project-description"
		onclick={(event) => event.target === event.currentTarget && removeProjectDialog?.close()}
	>
		<header>
			<div>
				<h2 id="remove-project-title">Remove project?</h2>
				<p id="remove-project-description">
					Remove {editingProject?.name} from HUE? Hermes transcripts will not be deleted.
				</p>
			</div>
		</header>
		<div class="confirmation-actions flex justify-end gap-2.5">
			<button type="button" title="Keep project" onclick={() => removeProjectDialog?.close()}
				>Cancel</button
			>
			<button
				type="button"
				class="danger-button text-destructive"
				title="Remove project"
				onclick={onremove}>Remove project</button
			>
		</div>
	</dialog>
</aside>
