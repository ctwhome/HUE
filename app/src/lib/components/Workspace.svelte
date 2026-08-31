<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { formatElapsed, selectSessionArtifacts, selectTranscriptTimeline } from '$lib';
	import { automaticSessionIcon } from '$lib/icon';
	import { applyPreferences, readPreferences } from '$lib/preferences';
	import type { CaptureInput } from '$lib/pwa/quick-capture';
	import {
		applyLastSessionSelections,
		rememberLastSessionSelection
	} from '$lib/session-selections';
	import type { WorkMode } from '$lib/work-mode';
	import GlobalNavigation, { type GlobalView } from './GlobalNavigation.svelte';
	import AttentionCenter from './notifications/AttentionCenter.svelte';
	import HermesPanel from './HermesPanel.svelte';
	import ProjectBrowserDock from './ProjectBrowserDock.svelte';
	import ProjectFilesDock from './ProjectFilesDock.svelte';
	import ProjectWorkbench from './ProjectWorkbench.svelte';
	import HealthStrip from './workbench/HealthStrip.svelte';
	import ProjectTerminalDock from './workbench/ProjectTerminalDock.svelte';
	import QuickCapture from './pwa/QuickCapture.svelte';
	import ContextPanel from './workspace/ContextPanel.svelte';
	import ExternalCronJobView from './workspace/ExternalCronJobView.svelte';
	import { MobileShellController } from './workspace/mobile-shell';
	import { readProjectPanels, togglePanelState as togglePanel } from './workspace/panel-state';
	import { workspaceApi } from './workspace/api';
	import { WorkspaceNavigation } from './workspace/navigation.svelte';
	import { isImageIcon, ProjectManagement } from './workspace/project-management.svelte';
	import ProjectRail from './workspace/ProjectRail.svelte';
	import SessionHeader from './workspace/SessionHeader.svelte';
	import SessionFinder from './workspace/SessionFinder.svelte';
	import SessionManagerOverlay from './workspace/SessionManagerOverlay.svelte';
	import SessionPaneGrid from './workspace/SessionPaneGrid.svelte';
	import ShellResizer from './workspace/ShellResizer.svelte';
	import WorkspaceWelcome from './workspace/WorkspaceWelcome.svelte';
	import DirtyGuardDialog from './workspace/DirtyGuardDialog.svelte';
	import { DirtyGuard } from './workspace/dirty-guard';
	import { installDirtyNavigation } from './workspace/dirty-navigation';
	import { preloadSessionViews } from './workspace/session-preload';
	import { createSessionController } from './workspace/session-controller.svelte';
	import SessionSurface from './workspace/SessionSurface.svelte';
	import {
		CHAT_BACKGROUND_EVENT,
		chatBackgroundStyle,
		resolveChatBackground,
		type ChatBackground
	} from './workspace/chat-background';
	import type {
		Project,
		Session,
		SessionFinderResult,
		SessionLoad,
		WorkspaceProps
	} from './workspace/types';
	let {
		projects: initialProjects,
		chatSessionCount: initialChatSessionCount = 0,
		cronSessionCount: initialCronSessionCount = 0,
		projectsCapability = 'available',
		projectsError = '',
		reconciliationIssues = []
	}: WorkspaceProps = $props();
	let chatSessionCount = $state(untrack(() => initialChatSessionCount));
	let cronSessionCount = $state(untrack(() => initialCronSessionCount));
	let loading = $state(false),
		error = $state('');
	let globalView = $state<GlobalView | null>(null),
		unreadNotifications = $state(0),
		finderOpen = $state(false);
	let now = $state(Date.now());
	let dirtyGuardOpen = $state(false),
		dirtyGuardDirty = $state(false);
	let mobile = $state(false),
		projectTools = $state(false),
		projectsPanelOpen = $state(true),
		sessionsPanelOpen = $state(true);
	let embedded = $derived(page.url.searchParams.get('embed') === 'chat');
	type ShellPane = 'projects' | 'sessions';
	let projectPaneWidth = $state(220),
		sessionPaneWidth = $state(320);
	let shellResize: { pane: ShellPane; x: number; width: number } | null = null;
	let chatPaneElement = $state<HTMLElement>();
	let projectDrawerElement = $state<HTMLElement>();
	let sessionDrawerElement = $state<HTMLElement>();
	let gestureActive = $state(false);
	let mobileShell: MobileShellController | null = null;
	let quickCapture: { open: (intent: 'capture' | 'share', token: string | null) => Promise<void> };
	const dirtyGuard = new DirtyGuard((guard) => {
		dirtyGuardOpen = guard.open;
		dirtyGuardDirty = guard.dirty;
	});
	function guarded(action: () => void) {
		if (!dirtyGuard.block(action)) action();
	}
	const setGlobalView = (view: GlobalView | null) => guarded(() => (globalView = view));
	function shellPaneLimits(pane: ShellPane) {
		const otherWidth = pane === 'projects' ? sessionPaneWidth : projectPaneWidth;
		return {
			min: pane === 'projects' ? 160 : 240,
			max: Math.max(pane === 'projects' ? 160 : 240, innerWidth - 56 - otherWidth - 320)
		};
	}
	function setShellPaneWidth(pane: ShellPane, next: number) {
		const { min, max } = shellPaneLimits(pane);
		const width = Math.min(max, Math.max(min, next));
		if (pane === 'projects') projectPaneWidth = width;
		else sessionPaneWidth = width;
	}
	function saveShellPaneWidth(pane: ShellPane) {
		const width = pane === 'projects' ? projectPaneWidth : sessionPaneWidth;
		localStorage.setItem(`hue:shell:${pane}:width`, String(Math.round(width)));
	}
	function setShellPaneOpen(pane: ShellPane, open: boolean, persist = true) {
		if (pane === 'projects') projectsPanelOpen = open;
		else sessionsPanelOpen = open;
		if (persist) localStorage.setItem(`hue:shell:${pane}:open`, String(open));
	}
	function toggleShellNavigation() {
		const open = !projectsPanelOpen && !sessionsPanelOpen;
		setShellPaneOpen('projects', open);
		setShellPaneOpen('sessions', open);
	}
	function startShellResize(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		const pane = target.dataset.pane as ShellPane;
		target.setPointerCapture(event.pointerId);
		shellResize = {
			pane,
			x: event.clientX,
			width: pane === 'projects' ? projectPaneWidth : sessionPaneWidth
		};
	}
	function resizeShellPane(event: PointerEvent) {
		if (shellResize)
			setShellPaneWidth(shellResize.pane, shellResize.width + event.clientX - shellResize.x);
	}
	function finishShellResize() {
		if (!shellResize) return;
		saveShellPaneWidth(shellResize.pane);
		shellResize = null;
	}
	function resizeShellPaneWithKeyboard(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const pane = (event.currentTarget as HTMLElement).dataset.pane as ShellPane;
		const width = pane === 'projects' ? projectPaneWidth : sessionPaneWidth;
		const { min, max } = shellPaneLimits(pane);
		setShellPaneWidth(
			pane,
			event.key === 'Home'
				? min
				: event.key === 'End'
					? max
					: width + (event.key === 'ArrowRight' ? 24 : -24)
		);
		saveShellPaneWidth(pane);
	}
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;
	const navigationRef: { current: WorkspaceNavigation | null } = { current: null };
	const sessionController = createSessionController({
		api: workspaceApi,
		getProject: () => navigationRef.current?.selectedProject ?? null,
		getSession: () => navigationRef.current?.selectedSession ?? null,
		getNavigation: () => navigationRef.current!,
		setError: (message) => (error = message),
		setLoading: (value) => (loading = value),
		rememberSelection: (selection) => rememberLastSessionSelection(localStorage, selection),
		focusNotificationTarget: (events, sourceEventId) =>
			sessionController.transcriptFollow.focusNotificationTarget(events, sourceEventId)
	});
	const { sessionState, messageState, runtimeState } = sessionController;
	const projectManagement = new ProjectManagement({
		initialProjects: untrack(() => initialProjects),
		api: workspaceApi,
		getSelectedProject: () => navigationRef.current?.selectedProject ?? null,
		setSelectedProject: (project) => navigationRef.current?.setSelectedProject(project),
		chooseProject: (project) => navigationRef.current!.chooseProject(project)
	});
	const navigation = new WorkspaceNavigation(
		untrack(() => initialProjects.find(({ rootAvailable }) => rootAvailable) ?? null),
		{
			...sessionController.navigationEffects,
			api: workspaceApi,
			getProjects: () => projectManagement.projects,
			adjustChatSessionCount: (change) =>
				(chatSessionCount = Math.max(0, chatSessionCount + change)),
			adjustCronSessionCount: (change) =>
				(cronSessionCount = Math.max(0, cronSessionCount + change)),
			applyCreatedSession: async (body, preserveWorkMode = false) => {
				const selectedSession = navigation.selectedSession;
				if (!selectedSession) {
					sessionState.applyCreated(body);
					return;
				}
				const selections = await applyLastSessionSelections({
					storage: preserveWorkMode
						? {
								getItem: (key) => {
									const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
									delete saved.workMode;
									return JSON.stringify(saved);
								}
							}
						: localStorage,
					runtime: body.runtime ?? { profile: 'default' },
					workMode: selectedSession.workMode ?? 'autonomous',
					changeRuntime: async (kind, value) => {
						const response = await workspaceApi<{ runtime: SessionLoad['runtime'] }>(
							navigation.sessionApiPath(selectedSession.sessionId),
							{ method: 'PATCH', body: JSON.stringify({ [kind]: value }) }
						);
						return response.runtime ?? {};
					},
					changeWorkMode: async (workMode) => {
						const response = await workspaceApi<{ workMode: WorkMode }>(
							navigation.sessionApiPath(selectedSession.sessionId),
							{ method: 'PATCH', body: JSON.stringify({ workMode }) }
						);
						return response.workMode;
					}
				});
				navigation.replaceSession({ ...selectedSession, workMode: selections.workMode });
				sessionState.applyCreated({ ...body, runtime: selections.runtime });
			},
			guard: (action) => dirtyGuard.block(action),
			isMobile: () => mobile,
			openCapture: (intent, token) => quickCapture.open(intent, token)
		}
	);
	navigationRef.current = navigation;
	async function createCapturedSession(capture: CaptureInput) {
		const project = capture.projectId
			? (projectManagement.projects.find(
					({ id, rootAvailable }) => id === capture.projectId && rootAvailable
				) ?? null)
			: null;
		await navigation.chooseProject(project, 'none');
		if (!(await navigation.createSession())) return false;
		messageState.composer = capture.text;
		messageState.images = capture.images;
		messageState.attachments = capture.attachments;
		messageState.saveCurrentDraft();
		await tick();
		messageState.composerElement?.focus();
		return true;
	}
	let selectedProject = $derived(navigation.selectedProject);
	function chooseProjectFromRail(project: Project | null, trigger?: HTMLElement) {
		if (mobile) {
			if (trigger) mobileShell?.rememberTrigger('sessions', trigger);
			void navigation.chooseProject(project);
			return;
		}
		if ((selectedProject?.id ?? null) === (project?.id ?? null)) {
			setShellPaneOpen('sessions', !sessionsPanelOpen);
			return;
		}
		setShellPaneOpen('sessions', true);
		void navigation.chooseProject(project);
	}
	function chooseSessionCollection(collection: 'chats' | 'cron', trigger?: HTMLElement) {
		if (mobile) {
			if (trigger) mobileShell?.rememberTrigger('sessions', trigger);
			void navigation.chooseSessionCollection(collection);
			return;
		}
		if (!selectedProject && navigation.sessionCollection === collection) {
			setShellPaneOpen('sessions', !sessionsPanelOpen);
			return;
		}
		setShellPaneOpen('sessions', true);
		void navigation.chooseSessionCollection(collection);
	}
	let panelProjectId = $derived(selectedProject?.id ?? '');
	let sessions = $derived(navigation.sessions);
	let workflows = $derived(navigation.workflows);
	let selectedSession = $derived(navigation.selectedSession);
	let selectedExternalCronJob = $derived(navigation.selectedExternalCronJob);
	let chatBackground = $state<ChatBackground | null>(null);
	let chatBackgroundRevision = $state(0);
	$effect(() => {
		chatBackgroundRevision;
		chatBackground =
			selectedSession && typeof localStorage !== 'undefined'
				? resolveChatBackground(localStorage, selectedSession.sessionId)
				: null;
	});
	let timeline = $derived(sessionState.timeline);
	let hasTranscript = $derived(selectTranscriptTimeline(timeline).length > 0);
	let artifacts = $derived(selectSessionArtifacts(timeline));
	let commands = $derived(sessionState.commands);
	let runtime = $derived(sessionState.runtime);
	let branch = $derived(sessionState.branch);
	let delivery = $derived(sessionState.delivery);
	let selectedAttentionStatus: Session['status'] = $derived.by(() => {
		const interaction = timeline.findLast(
			(item) => (item.kind === 'permission' || item.kind === 'clarify') && item.status === 'pending'
		);
		return interaction?.kind === 'permission'
			? 'waiting-permission'
			: interaction?.kind === 'clarify'
				? 'waiting-answer'
				: null;
	});
	let pendingInteraction = $derived.by(() => {
		const interaction = timeline.findLast(
			(item) => (item.kind === 'permission' || item.kind === 'clarify') && item.status === 'pending'
		);
		return interaction?.kind === 'permission'
			? `Permission: ${interaction.toolCall?.title ?? 'Hermes tool'}`
			: interaction?.kind === 'clarify'
				? `Question: ${interaction.message ?? 'Hermes needs input'}`
				: undefined;
	});
	let browserOpen = $state(true),
		filesOpen = $state(false);
	let fileRequest = $state<{ path: string; id: string } | null>(null);
	let previewUrl = $state('');
	let terminalOpen = $state(false);
	let terminalHeight = $state(300),
		sessionPaneCount = $state(1);
	let pendingSessionDraft = '';
	let sessionCreation: Promise<Session | null> | null = null;
	$effect(() => {
		projectTools = false;
		previewUrl = '';
		fileRequest = null;
		({ browserOpen, filesOpen, terminalOpen } = readProjectPanels(localStorage, panelProjectId));
		if (filesOpen) browserOpen = false;
		if (sessionPaneCount > 1 && innerWidth < 1600) browserOpen = false;
		terminalHeight = 300;
	});
	function toggleBrowserPanel() {
		const opening = !browserOpen;
		browserOpen = togglePanel(localStorage, panelProjectId, 'browser', browserOpen);
		if (opening && filesOpen)
			filesOpen = togglePanel(localStorage, panelProjectId, 'files', filesOpen);
	}
	function toggleFilesPanel() {
		const opening = !filesOpen;
		filesOpen = togglePanel(localStorage, panelProjectId, 'files', filesOpen);
		if (opening && browserOpen)
			browserOpen = togglePanel(localStorage, panelProjectId, 'browser', browserOpen);
	}
	async function ensureDraftSession() {
		if (navigation.selectedSession) return navigation.selectedSession;
		if (!sessionCreation) {
			sessionCreation = navigation.createSession().then(async (session) => {
				if (session) {
					messageState.composer = pendingSessionDraft;
					messageState.saveCurrentDraft();
					await tick();
				}
				return session;
			});
		}
		try {
			return await sessionCreation;
		} finally {
			sessionCreation = null;
		}
	}
	function createSessionFromDraft(event: Event) {
		pendingSessionDraft = (event.currentTarget as HTMLTextAreaElement).value;
		messageState.updateDraft(event);
		if (pendingSessionDraft && !navigation.selectedSession) void ensureDraftSession();
	}
	async function navigateFromFinder(result: SessionFinderResult) {
		const project = result.projectId
			? (projectManagement.projects.find(({ id }) => id === result.projectId) ?? null)
			: null;
		if (result.projectId && !project) {
			error = 'Project is no longer available';
			return;
		}
		globalView = null;
		await navigation.openFinderSession(
			project,
			result.sessionId,
			!project && result.folder === 'Schedules' ? 'cron' : 'chats'
		);
	}
	function openFinderResult(result: SessionFinderResult) {
		guarded(() => void navigateFromFinder(result));
	}
	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && finderOpen) {
			event.preventDefault();
			finderOpen = false;
			return;
		}
		if (
			event.key.toLowerCase() === 'k' &&
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			finderOpen = true;
			return;
		}
		if (event.key === 'Escape' && !document.querySelector('dialog[open]')) mobileShell?.close();
	}
	async function submitDraft(event: SubmitEvent) {
		event.preventDefault();
		if (navigation.selectedSession?.pending) return;
		if (!navigation.selectedSession && !(await ensureDraftSession())) return;
		await messageState.submit(event);
	}
	onMount(() => {
		const preloadAbort = new AbortController();
		const preload = () => {
			void preloadSessionViews(
				projectManagement.projects,
				workspaceApi,
				sessionState.preload,
				preloadAbort.signal
			);
		};
		let preloadIdleHandle: number | undefined;
		let preloadTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
		if ('requestIdleCallback' in window) {
			preloadIdleHandle = window.requestIdleCallback(preload, { timeout: 1_000 });
		} else preloadTimeoutHandle = globalThis.setTimeout(preload, 250);
		const refreshChatBackground = () => (chatBackgroundRevision += 1);
		window.addEventListener(CHAT_BACKGROUND_EVENT, refreshChatBackground);
		applyPreferences(document.documentElement, readPreferences(localStorage));
		for (const pane of ['projects', 'sessions'] as const) {
			const savedWidth = Number(localStorage.getItem(`hue:shell:${pane}:width`));
			if (savedWidth > 0) setShellPaneWidth(pane, savedWidth);
			const savedOpen = localStorage.getItem(`hue:shell:${pane}:open`);
			if (savedOpen === 'true' || savedOpen === 'false')
				setShellPaneOpen(pane, savedOpen === 'true', false);
		}
		elapsedTimer = setInterval(() => (now = Date.now()), 1000);
		mobileShell = new MobileShellController({
			drawer: (pane) => (pane === 'projects' ? projectDrawerElement : sessionDrawerElement)!,
			chat: () => chatPaneElement!,
			navigation,
			onMobile: (value) => (mobile = value),
			onVisual: (active) => (gestureActive = active)
		});
		mobileShell.start();
		return () => {
			preloadAbort.abort();
			if (preloadIdleHandle !== undefined) window.cancelIdleCallback(preloadIdleHandle);
			if (preloadTimeoutHandle !== undefined) globalThis.clearTimeout(preloadTimeoutHandle);
			window.removeEventListener(CHAT_BACKGROUND_EVENT, refreshChatBackground);
			mobileShell?.destroy();
			mobileShell = null;
			if (elapsedTimer) clearInterval(elapsedTimer);
		};
	});
	installDirtyNavigation(dirtyGuard, messageState.saveCurrentDraft);
</script>

<svelte:window
	onkeydown={handleGlobalKeydown}
	onbeforeunload={(event) => {
		if (dirtyGuardDirty) event.preventDefault();
	}}
/>
<div
	class="workspace grid h-dvh overflow-hidden bg-background text-foreground"
	class:ready={navigation.ready}
	class:drawer-gesture-active={gestureActive}
	class:mobile-projects={navigation.mobileDrawer === 'projects'}
	class:mobile-sessions={navigation.mobileDrawer === 'sessions'}
	class:projects-panel-closed={!projectsPanelOpen}
	class:sessions-panel-closed={!sessionsPanelOpen}
	class:embedded
	style={`--project-pane-width: ${projectPaneWidth}px; --session-pane-width: ${sessionPaneWidth}px; --project-shell-color: ${selectedProject?.color ?? 'var(--background)'}`}
>
	{#if !mobile}<GlobalNavigation
			view={globalView}
			unreadCount={unreadNotifications}
			navigationCollapsed={!projectsPanelOpen && !sessionsPanelOpen}
			onview={setGlobalView}
			onfind={() => (finderOpen = true)}
			ontogglenavigation={toggleShellNavigation}
		/>{/if}
	<SessionFinder bind:open={finderOpen} onnavigate={openFinderResult} />
	<AttentionCenter
		open={globalView === 'notifications'}
		projectId={selectedProject?.id ?? null}
		sessionId={selectedSession?.pending ? null : (selectedSession?.sessionId ?? null)}
		onclose={() => setGlobalView(null)}
		oncounts={(count) => (unreadNotifications = count)}
	/>
	{#if globalView && globalView !== 'notifications'}{#key globalView}<HermesPanel
				view={globalView}
				{commands}
				{dirtyGuard}
				onview={setGlobalView}
				oncommand={(command) => {
					guarded(() => {
						globalView = null;
						void messageState.sendText(`/${command.name}`, [], []);
					});
				}}
			/>{/key}{/if}
	<ProjectRail
		bind:element={projectDrawerElement}
		open={navigation.mobileDrawer === 'projects'}
		{mobile}
		projects={projectManagement.projects}
		{chatSessionCount}
		cronSessionCount={cronSessionCount + navigation.externalCronJobs.length}
		{selectedProject}
		sessionCollection={navigation.sessionCollection}
		{unreadNotifications}
		sessionsOpen={sessionsPanelOpen}
		{projectsCapability}
		{projectsError}
		{reconciliationIssues}
		bind:addProjectDialog={projectManagement.addProjectDialog}
		bind:editProjectDialog={projectManagement.editProjectDialog}
		bind:removeProjectDialog={projectManagement.removeProjectDialog}
		bind:projectIconPopover={projectManagement.projectIconPopover}
		bind:projectSettingsIconPopover={projectManagement.projectSettingsIconPopover}
		projectIconAnchor={projectManagement.projectIconAnchor}
		editingProject={projectManagement.editingProject}
		projectRoot={projectManagement.projectRoot}
		projectDirectories={projectManagement.projectDirectories}
		projectDirectoryParent={projectManagement.projectDirectoryParent}
		showHiddenDirectories={projectManagement.showHiddenDirectories}
		directoryLoading={projectManagement.directoryLoading}
		directoryError={projectManagement.directoryError}
		bind:projectName={projectManagement.projectName}
		bind:projectIcon={projectManagement.projectIcon}
		bind:projectColor={projectManagement.projectColor}
		bind:projectGroup={projectManagement.projectGroup}
		projectEditError={projectManagement.projectEditError}
		projectSaving={projectManagement.projectSaving}
		locatingProject={projectManagement.locatingProject}
		selectedFolders={projectManagement.selectedFolders}
		primaryFolder={projectManagement.primaryFolder}
		onprojectless={navigation.createProjectlessSession}
		oncollection={chooseSessionCollection}
		onaddopen={projectManagement.openAddProject}
		onchoose={chooseProjectFromRail}
		onlocate={projectManagement.openLocateProject}
		onedit={projectManagement.openEditProject}
		onicon={projectManagement.openProjectIcon}
		oniconselect={projectManagement.saveProjectIcon}
		oncolor={projectManagement.saveProjectColor}
		ongroup={projectManagement.saveProjectGroup}
		onsection={projectManagement.createProjectSection}
		onmove={projectManagement.moveProjectToSection}
		onhidden={projectManagement.toggleHiddenDirectories}
		ondirectory={projectManagement.loadDirectory}
		oncreatedirectory={projectManagement.createDirectory}
		ontogglefolder={projectManagement.toggleSelectedFolder}
		onprimarychoice={projectManagement.choosePrimaryFolder}
		oncreate={projectManagement.createProject}
		onaddfolder={projectManagement.addCurrentFolder}
		onimage={projectManagement.chooseProjectImage}
		onsavemetadata={projectManagement.saveProject}
		onsetprimary={projectManagement.setPrimaryFolder}
		onremovefolder={projectManagement.removeFolder}
		onlabel={projectManagement.setFolderLabel}
		onarchiveRequest={projectManagement.requestRemoveProject}
		onarchive={projectManagement.removeProject}
		onnotifications={() => setGlobalView('notifications')}
		onsettings={() => setGlobalView('app-settings')}
		isImage={isImageIcon}
	/>
	<ContextPanel
		bind:element={sessionDrawerElement}
		open={navigation.mobileDrawer === 'sessions'}
		{mobile}
		{selectedProject}
		sessionCollection={navigation.sessionCollection}
		{loading}
		{sessions}
		externalCronJobs={navigation.externalCronJobs}
		externalCronError={navigation.externalCronError}
		{selectedExternalCronJob}
		{selectedSession}
		selectedDelivery={delivery}
		selectedStatus={selectedAttentionStatus}
		bind:sessionSearch={navigation.sessionSearch}
		bind:showArchived={navigation.showArchived}
		{now}
		oncreate={navigation.createSession}
		onopen={(session) => navigation.openSession(session, 'push')}
		onexternalopen={(job) => navigation.openExternalCronJob(job, 'push')}
		onback={(trigger) => mobileShell?.open('projects', trigger)}
		onedit={navigation.openEditSession}
		onicon={navigation.openSessionIconEditor}
		onarchive={navigation.archiveSession}
		ondelete={navigation.deleteSessionFromRow}
		onsearch={navigation.searchSessionList}
		isImage={isImageIcon}
		automaticIcon={automaticSessionIcon}
		elapsed={formatElapsed}
	/>
	<ShellResizer
		pane="projects"
		aria-label="Resize Projects"
		min={160}
		value={projectPaneWidth}
		onpointerdown={startShellResize}
		onpointermove={resizeShellPane}
		onfinish={finishShellResize}
		onkeydown={resizeShellPaneWithKeyboard}
	/>
	<ShellResizer
		pane="sessions"
		aria-label="Resize Sessions"
		min={240}
		value={sessionPaneWidth}
		onpointerdown={startShellResize}
		onpointermove={resizeShellPane}
		onfinish={finishShellResize}
		onkeydown={resizeShellPaneWithKeyboard}
	/>
	<div
		bind:this={chatPaneElement}
		class="session-workspace flex h-full min-h-0 min-w-0 overflow-hidden"
		class:terminal-open={terminalOpen && !mobile}
		inert={mobile && navigation.mobileDrawer !== null}
		aria-hidden={mobile && navigation.mobileDrawer !== null ? 'true' : undefined}
		style={`--terminal-panel-height: ${terminalHeight}px`}
	>
		{#if selectedExternalCronJob}<ExternalCronJobView
				job={selectedExternalCronJob}
				{mobile}
				onback={(trigger) => mobileShell?.open('sessions', trigger)}
				onupdated={(updated) => {
					navigation.externalCronJobs = navigation.externalCronJobs.map((job) =>
						job.jobId === updated.jobId && job.profile === updated.profile
							? { ...job, ...updated }
							: job
					);
					navigation.selectedExternalCronJob = { ...selectedExternalCronJob, ...updated };
				}}
				onread={() => {
					const unreadCount = Math.max(0, (selectedExternalCronJob.unreadCount ?? 0) - 1);
					navigation.externalCronJobs = navigation.externalCronJobs.map((job) =>
						job.jobId === selectedExternalCronJob.jobId &&
						job.profile === selectedExternalCronJob.profile
							? { ...job, unreadCount }
							: job
					);
					navigation.selectedExternalCronJob = { ...selectedExternalCronJob, unreadCount };
				}}
				ondeleted={(deleted) => {
					navigation.externalCronJobs = navigation.externalCronJobs.filter(
						(job) => job.jobId !== deleted.jobId || job.profile !== deleted.profile
					);
					navigation.selectedExternalCronJob = null;
					if (mobile) navigation.setMobileDrawer('sessions', 'replace');
				}}
			/>
		{:else}<SessionPaneGrid
				{sessions}
				project={selectedProject}
				projectId={selectedProject?.id ?? null}
				sessionListLoaded={navigation.loadedSessionListProjectId ===
					(selectedProject?.id ?? navigation.sessionCollection)}
				{workflows}
				primarySession={selectedSession?.pending ? null : selectedSession}
				allowDocking={!embedded}
				restorePrimarySession={!mobile && !selectedSession?.pending}
				onpanecount={(count) => {
					sessionPaneCount = count;
					if (count > 1 && innerWidth < 1600) browserOpen = false;
				}}
				onprimaryclose={navigation.openSession}
				onsessionupdate={navigation.replaceSession}
				onrunworkflow={navigation.runWorkflow}
			>
				<main
					class="session-view chat-background-surface flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
					class:empty-session={!hasTranscript}
					class:personal-background={chatBackground !== null}
					style={chatBackgroundStyle(chatBackground)}
				>
					<SessionHeader
						session={selectedSession}
						project={selectedProject}
						{runtime}
						{delivery}
						{pendingInteraction}
						contextPercent={runtimeState.contextPercent}
						{artifacts}
						mediaPath={selectedSession
							? navigation.sessionApiPath(selectedSession.sessionId, '/media')
							: ''}
						{projectTools}
						{mobile}
						{unreadNotifications}
						onsessions={(trigger) => mobileShell?.open('sessions', trigger)}
						onnotifications={() => setGlobalView('notifications')}
						onprojecttools={(open) => (projectTools = open)}
						onicon={(event) => {
							if (selectedSession && !selectedSession.pending)
								navigation.openSessionIconEditor(event, selectedSession);
						}}
						onmanage={(event) => {
							if (selectedSession && !selectedSession.pending)
								navigation.openEditSession(event, selectedSession);
						}}
					/>
					{#if error}<div
							class="error mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2.5 text-sm text-destructive"
							role="alert"
						>
							{error}
						</div>{/if}
					{#if selectedProject?.rootAvailable && mobile && !selectedSession}<button
							class="mobile-project-tools mx-3 mt-2 min-h-11 rounded-md border border-border px-3 text-sm"
							aria-label={projectTools ? 'Back to chat' : 'Open Project tools'}
							onclick={() => (projectTools = !projectTools)}
							>{projectTools ? 'Back to chat' : 'Project tools'}</button
						>{/if}
					{#if selectedProject?.rootAvailable && navigation.ready && mobile && projectTools}
						{#key selectedProject.id}
							<ProjectWorkbench
								projectId={selectedProject.id}
								projectName={selectedProject.name}
								compact={true}
								onpreviewchange={(url) => (previewUrl = url)}
								onbranch={(value) => (branch = value)}
								onreviewcontext={messageState.addReviewContext}
								{dirtyGuard}
							/>
						{/key}
					{:else if selectedSession || (selectedProject?.rootAvailable && navigation.ready)}
						<SessionSurface
							controller={sessionController}
							{navigation}
							project={selectedProject}
							session={selectedSession}
							{workflows}
							sessionLabel={selectedSession?.title ||
								selectedSession?.sessionId ||
								'New Hermes Session'}
							mediaPath={selectedSession
								? navigation.sessionApiPath(selectedSession.sessionId, '/media')
								: ''}
							onsubmit={submitDraft}
							oninput={createSessionFromDraft}
							onrunworkflow={navigation.runWorkflow}
							unavailableRecovery={selectedSession?.available === false
								? (selectedSession.recovery ?? 'Hermes Session is unavailable.')
								: null}
							showContextUsage={false}
							ready={!selectedSession?.pending}
						/>
					{:else if selectedProject && !selectedProject.rootAvailable}
						<section
							class="mx-auto mt-[12vh] grid max-w-xl gap-4 p-8 text-center text-muted-foreground"
							aria-label="Project folder unavailable"
						>
							<h2 class="text-foreground">Project folder unavailable</h2>
							<p>
								Primary folder {selectedProject.primaryPath} is unavailable. Choose an available Project
								folder as primary before opening Sessions, Git, terminal, or preview tools.
							</p>
							<div class="flex flex-wrap justify-center gap-2">
								<button
									class="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
									onclick={() => {
										if (mobile) navigation.setMobileDrawer('projects', 'push');
										projectManagement.openEditProject(null, selectedProject);
									}}>Manage folders</button
								>
								<button
									class="min-h-11 rounded-md border border-border px-4"
									onclick={() => {
										if (mobile) navigation.setMobileDrawer('projects', 'push');
										projectManagement.requestRemoveStaleProject(selectedProject);
									}}>Archive</button
								>
								<button
									class="min-h-11 rounded-md border border-border px-4"
									onclick={() => navigation.chooseProject(null)}>Open without Project</button
								>
							</div>
						</section>
					{:else}
						<WorkspaceWelcome
							projectCount={projectManagement.projects.length}
							{projectsCapability}
							{projectsError}
							onadd={projectManagement.openAddProject}
							onprojectless={navigation.createProjectlessSession}
						/>
					{/if}
				</main>
			</SessionPaneGrid>{/if}
		{#if selectedProject?.rootAvailable && navigation.ready && !mobile}
			{#key selectedProject.id}
				<ProjectBrowserDock
					projectId={selectedProject.id}
					open={browserOpen}
					onpreviewchange={(url) => (previewUrl = url)}
				/>
				<ProjectFilesDock
					projectId={selectedProject.id}
					open={filesOpen}
					{fileRequest}
					{dirtyGuard}
					onclose={toggleFilesPanel}
				/>
				<ProjectWorkbench
					projectId={selectedProject.id}
					projectName={selectedProject.name}
					compact={false}
					docked={true}
					{browserOpen}
					{filesOpen}
					{terminalOpen}
					onpreviewchange={(url) => (previewUrl = url)}
					onbrowser={toggleBrowserPanel}
					onfiles={toggleFilesPanel}
					onopenfile={(path) => {
						fileRequest = { path, id: crypto.randomUUID() };
						if (!filesOpen) toggleFilesPanel();
					}}
					onterminal={() =>
						(terminalOpen = togglePanel(localStorage, panelProjectId, 'terminal', terminalOpen))}
					onbranch={(value) => (branch = value)}
					onreviewcontext={messageState.addReviewContext}
					{dirtyGuard}
				/>
			{/key}
		{/if}
		{#if terminalOpen && selectedProject?.rootAvailable && !mobile}
			{#key selectedProject.id}
				<ProjectTerminalDock projectId={selectedProject.id} bind:height={terminalHeight} />
			{/key}
		{/if}
	</div>
	{#if selectedProject && navigation.ready && !mobile}
		{#key selectedProject.id}
			<HealthStrip
				projectId={selectedProject.id}
				projectName={selectedProject.name}
				color={selectedProject.color}
				{previewUrl}
			/>
		{/key}
	{/if}
</div>
<SessionManagerOverlay {navigation} canDuplicate={runtime.capabilities?.sessionFork === true} />
<QuickCapture
	bind:this={quickCapture}
	projects={projectManagement.projects}
	oncreate={createCapturedSession}
/>
<DirtyGuardDialog
	open={dirtyGuardOpen}
	onkeep={() => dirtyGuard.keepEditing()}
	ondiscard={() => dirtyGuard.discardAndContinue()}
/>
