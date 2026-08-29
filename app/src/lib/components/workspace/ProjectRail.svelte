<script lang="ts">
	import { onMount } from 'svelte';
	import Archive from '~icons/lucide/archive';
	import ArrowDown from '~icons/lucide/arrow-down';
	import ArrowUp from '~icons/lucide/arrow-up';
	import Bell from '~icons/lucide/bell';
	import Check from '~icons/lucide/check';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Ellipsis from '~icons/lucide/ellipsis';
	import EllipsisVertical from '~icons/lucide/ellipsis-vertical';
	import Folder from '~icons/lucide/folder';
	import FolderPlus from '~icons/lucide/folder-plus';
	import MessageSquare from '~icons/lucide/message-square';
	import Menu from '~icons/lucide/menu';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import { dropBefore, moveBefore, moveBy, readStringArray, sortByOrder } from '$lib/drag-order';
	import IconEditorPopover from '$lib/components/IconEditorPopover.svelte';
	import ProjectFoldersEditor from './ProjectFoldersEditor.svelte';
	import type { Directory, Project } from './types';

	let {
		element = $bindable(),
		open,
		mobile,
		projects,
		chatSessionCount,
		selectedProject,
		unreadNotifications,
		sessionsOpen,
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
		onsection,
		onmove,
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
		onnotifications,
		onsettings,
		isImage
	}: {
		element?: HTMLElement;
		open: boolean;
		mobile: boolean;
		projects: Project[];
		chatSessionCount: number;
		selectedProject: Project | null;
		unreadNotifications: number;
		sessionsOpen: boolean;
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
		onchoose: (project: Project | null, trigger?: HTMLElement) => void;
		onlocate: (project: Project) => void;
		onedit: (event: MouseEvent, project: Project) => void;
		onicon: (event: MouseEvent, project: Project) => void;
		oniconselect: (icon: string | null) => void;
		oncolor: (color: string) => void;
		ongroup: (group: string) => void;
		onsection: (name: string, projectIds: string[]) => Promise<boolean>;
		onmove: (projectId: string, group: string | null) => Promise<boolean>;
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
		onnotifications: () => void;
		onsettings: () => void;
		isImage: (icon: string | null) => boolean;
	} = $props();

	const currentFolderSelected = $derived(selectedFolders.includes(projectRoot));
	const addDisabled = $derived(projectsCapability !== 'available');
	let projectOrder = $state<string[]>([]);
	let groupOrder = $state<string[]>([]);
	const projectGroups = $derived.by(() => {
		const groups = new Map<string | null, Project[]>();
		for (const project of sortByOrder(projects, projectOrder, ({ id }) => id)) {
			const label = project.group || null;
			groups.set(label, [...(groups.get(label) ?? []), project]);
		}
		return sortByOrder(
			[...groups].map(([label, items]) => ({ label, projects: items })),
			groupOrder,
			({ label }) => label ?? ''
		);
	});
	const groupLabels = $derived(
		projectGroups.flatMap((group) => (group.label ? [group.label] : []))
	);
	let collapsedGroups = $state(new Set<string>());
	let addSectionDialog = $state<HTMLDialogElement>();
	let sectionMenu = $state<HTMLElement>();
	let sectionMenuOpen = $state(false);
	let sectionName = $state('');
	let sectionProjectIds = $state<string[]>([]);
	let sectionSubmitted = $state(false);
	let draggedProjectId = $state<string | null>(null);
	let draggedGroup = $state<string | null>(null);
	let dropGroup = $state<string | null>(null);
	let dropProjectId = $state<string | null>(null);
	let projectDropPosition = $state<'before' | 'after'>('before');
	const touchDragDelay = 250;
	let touchProjectId: string | null = null;
	let touchIdentifier: number | null = null;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchX = 0;
	let touchY = 0;
	let touchDragTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		collapsedGroups = new Set(readStringArray(localStorage, 'hue:project-groups:collapsed'));
		projectOrder = readStringArray(localStorage, 'hue:project-order');
		groupOrder = readStringArray(localStorage, 'hue:project-group-order');
		window.addEventListener('touchmove', moveProjectTouch, { passive: false });
		window.addEventListener('touchend', finishProjectTouch, { passive: false });
		window.addEventListener('touchcancel', cancelProjectTouch);
		return () => {
			cancelProjectTouch();
			window.removeEventListener('touchmove', moveProjectTouch);
			window.removeEventListener('touchend', finishProjectTouch);
			window.removeEventListener('touchcancel', cancelProjectTouch);
		};
	});

	function toggleGroup(label: string) {
		const next = new Set(collapsedGroups);
		if (next.has(label)) next.delete(label);
		else next.add(label);
		collapsedGroups = next;
		localStorage.setItem('hue:project-groups:collapsed', JSON.stringify([...next]));
	}

	function openSectionDialog() {
		sectionName = '';
		sectionProjectIds = selectedProject ? [selectedProject.id] : [];
		sectionSubmitted = false;
		addSectionDialog?.showModal();
	}

	function toggleSectionProject(id: string) {
		sectionProjectIds = sectionProjectIds.includes(id)
			? sectionProjectIds.filter((projectId) => projectId !== id)
			: [...sectionProjectIds, id];
	}

	async function createSection(event: SubmitEvent) {
		event.preventDefault();
		sectionSubmitted = true;
		if (await onsection(sectionName, sectionProjectIds)) addSectionDialog?.close();
	}

	function startProjectDrag(event: DragEvent, projectId: string) {
		draggedProjectId = projectId;
		event.dataTransfer?.setData('application/x-hue-project-id', projectId);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function startGroupDrag(event: DragEvent, group: string) {
		draggedGroup = group;
		event.dataTransfer?.setData('application/x-hue-project-group', group);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function allowProjectDrop(
		event: DragEvent,
		group: string | null,
		projectId: string | null = null
	) {
		event.preventDefault();
		dropGroup = group ?? '';
		dropProjectId = projectId;
		if (projectId) {
			const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
			projectDropPosition = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
		}
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
	}

	function moveProject(projectId: string, group: string | null, before: string | null) {
		projectOrder = moveBefore(
			projectOrder.length ? projectOrder : projects.map(({ id }) => id),
			projectId,
			before
		);
		localStorage.setItem('hue:project-order', JSON.stringify(projectOrder));
		if (projects.find(({ id }) => id === projectId)?.group !== group) void onmove(projectId, group);
	}

	function moveProjectBy(projectId: string, offset: -1 | 1) {
		const order = sortByOrder(projects, projectOrder, ({ id }) => id).map(({ id }) => id);
		projectOrder = moveBy(order, projectId, offset);
		localStorage.setItem('hue:project-order', JSON.stringify(projectOrder));
	}
	function projectPosition(projectId: string) {
		return sortByOrder(projects, projectOrder, ({ id }) => id).findIndex(
			({ id }) => id === projectId
		);
	}

	function dropProject(event: DragEvent, group: string | null, before: string | null = null) {
		event.preventDefault();
		const projectId =
			event.dataTransfer?.getData('application/x-hue-project-id') || draggedProjectId;
		draggedProjectId = null;
		dropGroup = null;
		dropProjectId = null;
		if (projectId) moveProject(projectId, group, before);
	}

	function dropOnProject(event: DragEvent, project: Project) {
		const projectId =
			event.dataTransfer?.getData('application/x-hue-project-id') || draggedProjectId;
		const order = projectOrder.length ? projectOrder : projects.map(({ id }) => id);
		dropProject(
			event,
			project.group,
			projectId
				? dropBefore(order, projectId, project.id, projectDropPosition === 'after')
				: project.id
		);
	}

	function dropOnGroup(event: DragEvent, group: string) {
		const movedGroup =
			event.dataTransfer?.getData('application/x-hue-project-group') || draggedGroup;
		if (!movedGroup) return dropProject(event, group);
		event.preventDefault();
		groupOrder = moveBefore(groupLabels, movedGroup, group);
		localStorage.setItem('hue:project-group-order', JSON.stringify(groupOrder));
		draggedGroup = null;
		dropGroup = null;
		dropProjectId = null;
	}

	function finishProjectDrag() {
		draggedProjectId = null;
		draggedGroup = null;
		dropGroup = null;
		dropProjectId = null;
	}

	function startProjectTouch(event: TouchEvent, projectId: string) {
		if (event.touches.length !== 1) {
			cancelProjectTouch();
			return;
		}
		const touch = event.changedTouches[0];
		touchProjectId = projectId;
		touchIdentifier = touch.identifier;
		touchStartX = touchX = touch.clientX;
		touchStartY = touchY = touch.clientY;
		touchDragTimer = setTimeout(() => {
			if (!touchProjectId) return;
			draggedProjectId = touchProjectId;
			updateProjectTouch(touchX, touchY);
		}, touchDragDelay);
	}

	function updateProjectTouch(clientX: number, clientY: number) {
		const containsPointer = (node: Element) => {
			const bounds = node.getBoundingClientRect();
			return (
				clientX >= bounds.left &&
				clientX <= bounds.right &&
				clientY >= bounds.top &&
				clientY <= bounds.bottom
			);
		};
		const row = [...document.querySelectorAll<HTMLElement>('[data-project-id]')].find(
			containsPointer
		);
		if (row?.dataset.projectId) {
			const project = projects.find(({ id }) => id === row.dataset.projectId);
			if (!project) return;
			dropGroup = project.group ?? '';
			dropProjectId = project.id;
			const bounds = row.getBoundingClientRect();
			projectDropPosition = clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
			return;
		}
		const group = [...document.querySelectorAll<HTMLElement>('[data-project-group]')].find(
			containsPointer
		);
		if (group) {
			dropGroup = group.dataset.projectGroup ?? '';
			dropProjectId = null;
			return;
		}
		dropGroup = null;
		dropProjectId = null;
	}

	function clearProjectTouch() {
		if (touchDragTimer) clearTimeout(touchDragTimer);
		touchDragTimer = null;
		touchProjectId = null;
		touchIdentifier = null;
	}

	function moveProjectTouch(event: TouchEvent) {
		if (touchIdentifier === null || !touchProjectId) return;
		const touch = [...event.touches].find(({ identifier }) => identifier === touchIdentifier);
		if (!touch) return;
		touchX = touch.clientX;
		touchY = touch.clientY;
		if (!draggedProjectId) {
			if (Math.hypot(touchX - touchStartX, touchY - touchStartY) < 8) return;
			clearProjectTouch();
			return;
		}
		event.preventDefault();
		updateProjectTouch(touchX, touchY);
	}

	function finishProjectTouch(event: TouchEvent) {
		if (
			touchIdentifier === null ||
			!touchProjectId ||
			![...event.changedTouches].some(({ identifier }) => identifier === touchIdentifier)
		)
			return;
		if (draggedProjectId) {
			event.preventDefault();
			if (dropProjectId || dropGroup !== null) {
				const order = projectOrder.length ? projectOrder : projects.map(({ id }) => id);
				const before = dropProjectId
					? dropBefore(order, touchProjectId, dropProjectId, projectDropPosition === 'after')
					: null;
				moveProject(touchProjectId, dropGroup || null, before);
			}
		}
		clearProjectTouch();
		finishProjectDrag();
	}

	function cancelProjectTouch() {
		clearProjectTouch();
		finishProjectDrag();
	}
</script>

<aside
	bind:this={element}
	id="project-drawer"
	class="project-rail flex min-h-0 flex-col gap-3 border-r border-border bg-card/95 px-2 py-3"
	class:open
	inert={mobile && !open}
	aria-hidden={mobile ? !open : undefined}
	aria-label="Projects"
>
	<div class="section-heading flex items-center justify-between">
		<span
			class="section-label px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
			>Projects</span
		>
		<div class="project-panel-actions flex gap-1">
			{#if mobile}<button
					class="icon-button mobile-project-global-action grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Notifications"
					title="Notifications"
					onclick={onnotifications}
				>
					<Bell width={20} height={20} aria-hidden="true" />
					{#if unreadNotifications}<span class="notification-badge"
							>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span
						>{/if}
				</button>
				<button
					class="icon-button mobile-project-global-action grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="App settings"
					title="App settings"
					onclick={onsettings}><Menu width={20} height={20} aria-hidden="true" /></button
				>{/if}
			<button
				class="icon-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Project options"
				aria-haspopup="menu"
				aria-expanded={sectionMenuOpen}
				popovertarget="project-section-menu"
				title="Project options"
				disabled={addDisabled || projects.length === 0}
				><Ellipsis width={18} height={18} aria-hidden="true" /></button
			>
			<button
				class="icon-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Add Hermes Project"
				title={addDisabled ? projectsError : 'Add Hermes Project'}
				disabled={addDisabled}
				onclick={onaddopen}><Plus width={18} height={18} aria-hidden="true" /></button
			>
		</div>
	</div>

	{#if projectsCapability !== 'available'}
		<p
			class="rounded-lg border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 text-xs text-[var(--warning)]"
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
			class="rounded-lg border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 text-xs text-[var(--warning)]"
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
				aria-controls={!selectedProject ? 'session-drawer' : undefined}
				aria-expanded={!selectedProject ? sessionsOpen : undefined}
				onclick={(event) => onchoose(null, event.currentTarget)}
			>
				<MessageSquare
					class="project-icon grid size-(--navigation-icon-size) shrink-0 place-items-center rounded-md"
					width={18}
					height={18}
					aria-hidden="true"
				/>
				<span class="project-name min-w-0 flex-1 truncate">Chats</span>
				{#if chatSessionCount}<span
						class="project-session-count shrink-0 text-xs tabular-nums text-muted-foreground"
						aria-label={`${chatSessionCount} non-archived Chats`}>{chatSessionCount}</span
					>{/if}
			</button>
			<button
				class="icon-button workspace-session-add absolute top-1/2 right-0 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="New chat"
				title="New chat"
				onclick={onprojectless}><Plus width={18} height={18} aria-hidden="true" /></button
			>
		</div>
		{#if draggedProjectId && projects.find(({ id }) => id === draggedProjectId)?.group}<div
				class={`mt-1 flex min-h-11 items-center rounded-md border border-dashed px-2 text-xs sm:min-h-8 ${dropGroup === '' ? 'border-ring bg-accent text-foreground ring-2 ring-ring' : 'border-border text-muted-foreground'}`}
				data-project-group=""
				role="group"
				aria-label="Move Project to ungrouped"
				ondragover={(event) => allowProjectDrop(event, null)}
				ondrop={(event) => dropProject(event, null)}
			>
				Move to ungrouped
			</div>{/if}
		{#each projectGroups as group (group.label ?? '')}
			{#if group.label}<button
					class={`mt-4 flex min-h-11 w-full items-center gap-1 rounded-md border border-border/60 bg-muted/80 px-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-6 ${dropGroup === group.label ? 'bg-accent text-foreground shadow-sm ring-2 ring-ring' : ''}`}
					draggable="true"
					data-project-group={group.label}
					aria-label={draggedProjectId ? `Move Project to ${group.label}` : group.label}
					aria-expanded={!collapsedGroups.has(group.label)}
					title={group.label}
					ondragstart={(event) => startGroupDrag(event, group.label!)}
					ondragend={finishProjectDrag}
					ondragover={(event) => allowProjectDrop(event, group.label!)}
					ondrop={(event) => dropOnGroup(event, group.label!)}
					onclick={() => toggleGroup(group.label!)}
				>
					<ChevronRight
						class={`shrink-0 transition-transform ${collapsedGroups.has(group.label) ? '' : 'rotate-90'}`}
						width={11}
						height={11}
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1 truncate text-xs font-bold">{group.label}</span>
					{#if draggedProjectId && dropGroup === group.label}<span>Drop here</span>{/if}
				</button>{/if}
			{#if !group.label || !collapsedGroups.has(group.label)}
				{#each group.projects as project (project.id)}
					<div
						class="project-row group relative select-none"
						data-project-id={project.id}
						class:opacity-40={draggedProjectId === project.id}
						role="group"
						aria-label={`Project ${project.name}`}
						ondragover={(event) => allowProjectDrop(event, project.group, project.id)}
						ondrop={(event) => dropOnProject(event, project)}
					>
						{#if dropProjectId === project.id && draggedProjectId !== project.id}<span
								class={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-ring ring-2 ring-background ${projectDropPosition === 'before' ? '-top-px' : '-bottom-px'}`}
								aria-hidden="true"
							></span>{/if}
						{#if project.color}<span
								class="project-color-indicator pointer-events-none absolute inset-y-1 -left-1 w-1 rounded-full"
								style={`background-color: ${project.color}`}
								aria-hidden="true"
							></span>{/if}
						<button
							class="project-select flex min-h-11 w-full cursor-grab items-center gap-2 rounded-md bg-transparent py-1 pr-8 pl-2 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing [&.active]:bg-accent [&.active]:text-foreground"
							class:active={selectedProject?.id === project.id}
							class:bg-accent={dropProjectId === project.id && draggedProjectId !== project.id}
							aria-current={selectedProject?.id === project.id ? 'page' : undefined}
							aria-controls={selectedProject?.id === project.id ? 'session-drawer' : undefined}
							aria-expanded={selectedProject?.id === project.id ? sessionsOpen : undefined}
							draggable="true"
							ondragstart={(event) => startProjectDrag(event, project.id)}
							ondragend={finishProjectDrag}
							ontouchstart={(event) => startProjectTouch(event, project.id)}
							onclick={(event) => onchoose(project, event.currentTarget)}
						>
							{#if isImage(project.icon)}<img
									class="project-icon project-icon-image size-8 rounded-md object-cover"
									src={project.icon ?? ''}
									alt=""
								/>{:else if project.icon}<span
									class="project-icon grid size-8 place-items-center rounded-md text-2xl"
									>{project.icon}</span
								>{:else}<Folder
									class="project-icon project-icon-default size-8 text-muted-foreground"
									width={18}
									height={18}
									aria-hidden="true"
								/>{/if}
							<span class="project-name min-w-0 flex-1 truncate">{project.name}</span>
							{#if !project.rootAvailable}<small class="text-[var(--warning)]">Missing</small>{/if}
							{#if project.sessionCount}<span
									class="project-session-count shrink-0 text-xs text-muted-foreground tabular-nums"
									aria-label={`${project.sessionCount} non-archived Sessions`}
									>{project.sessionCount}</span
								>{/if}
						</button>
						<button
							class="project-edit absolute top-1/2 right-0 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent focus:opacity-100"
							aria-label={`Edit ${project.name}`}
							title={`Edit ${project.name}`}
							onclick={(event) => onedit(event, project)}
							><EllipsisVertical width={16} height={16} aria-hidden="true" /></button
						>
					</div>
				{/each}
			{/if}
		{/each}
	</nav>
	<div
		bind:this={sectionMenu}
		id="project-section-menu"
		class="project-section-menu w-44 rounded-lg border border-border bg-card p-1 text-foreground shadow-xl"
		popover="auto"
		role="menu"
		aria-label="Project options"
		ontoggle={(event) =>
			(sectionMenuOpen = (event.currentTarget as HTMLElement).matches(':popover-open'))}
	>
		<button
			class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			role="menuitem"
			aria-label="Add Project section"
			onclick={() => {
				sectionMenu?.hidePopover();
				openSectionDialog();
			}}
			><FolderPlus width={15} height={15} aria-hidden="true" /> Add section</button
		>
	</div>

	<dialog
		bind:this={addSectionDialog}
		class="add-project-dialog fixed m-0 w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="add-project-section-title"
		onclick={(event) => event.target === event.currentTarget && addSectionDialog?.close()}
	>
		<header>
			<div>
				<h2 id="add-project-section-title">Add Project section</h2>
				<p>Choose a name and the Projects to group together.</p>
			</div>
		</header>
		<form class="grid gap-3 p-3 sm:p-0" onsubmit={createSection}>
			<label class="grid gap-1 text-sm font-medium"
				>Section name<input
					class="min-h-11"
					bind:value={sectionName}
					maxlength="100"
					required
				/></label
			>
			<fieldset class="grid gap-1 rounded-lg border border-border p-2">
				<legend class="px-1 text-sm font-medium">Projects</legend>
				{#each projects as project (project.id)}
					<label class="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-accent">
						<input
							type="checkbox"
							checked={sectionProjectIds.includes(project.id)}
							onchange={() => toggleSectionProject(project.id)}
						/>
						<span class="truncate">{project.name}</span>
					</label>
				{/each}
			</fieldset>
			{#if sectionSubmitted && projectEditError}<p class="text-sm text-destructive" role="alert">
					{projectEditError}
				</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="min-h-11" onclick={() => addSectionDialog?.close()}
					>Cancel</button
				>
				<button
					type="submit"
					class="min-h-11"
					disabled={projectSaving || !sectionName.trim() || !sectionProjectIds.length}
					>Create section</button
				>
			</div>
		</form>
		<button
			class="icon-button absolute top-3 right-3 grid size-11 place-items-center rounded-md"
			aria-label="Close section creator"
			title="Close"
			onclick={() => addSectionDialog?.close()}
			><X width={18} height={18} aria-hidden="true" /></button
		>
	</dialog>

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
				title="Parent directory"><ArrowUp width={16} height={16} aria-hidden="true" /></button
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
						<Folder width={16} height={16} aria-hidden="true" /><span class="truncate"
							>{directory.name}</span
						>
					</button>
				{/each}
			{/if}
		</section>

		{#if locatingProject}
			<div class="mt-3 flex justify-end">
				<button class="min-h-11" disabled={!projectRoot || projectSaving} onclick={onaddfolder}>
					<FolderPlus width={16} height={16} aria-hidden="true" /> Add this folder
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
					{#if currentFolderSelected}<Check width={16} height={16} aria-hidden="true" /> Remove current
						folder{:else}<FolderPlus width={16} height={16} aria-hidden="true" /> Select current folder{/if}
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
								onclick={() => ontogglefolder(folder)}
								><X width={16} height={16} aria-hidden="true" /></button
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
			onclick={() => addProjectDialog?.close()}
			><X width={18} height={18} aria-hidden="true" /></button
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
					>{:else}<Folder
						class="text-muted-foreground"
						width={20}
						height={20}
						aria-hidden="true"
					/>{/if}
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
				onclick={() => editProjectDialog?.hidePopover()}
				><X width={17} height={17} aria-hidden="true" /></button
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
				<div class="grid grid-cols-2 gap-1">
					<button
						type="button"
						class="session-menu-action"
						disabled={!editingProject || projectPosition(editingProject.id) <= 0}
						onclick={() => editingProject && moveProjectBy(editingProject.id, -1)}
						><ArrowUp width={16} height={16} aria-hidden="true" /> Move up</button
					>
					<button
						type="button"
						class="session-menu-action"
						disabled={!editingProject || projectPosition(editingProject.id) >= projects.length - 1}
						onclick={() => editingProject && moveProjectBy(editingProject.id, 1)}
						><ArrowDown width={16} height={16} aria-hidden="true" /> Move down</button
					>
				</div>
				<button
					type="button"
					class="session-menu-action text-destructive"
					disabled={projectSaving}
					onclick={onarchiveRequest}
					><Archive width={16} height={16} aria-hidden="true" /> Archive Project</button
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
