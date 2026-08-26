<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { Diamond, Folder, FolderKanban, List } from 'lucide-svelte';
	import { formatElapsed, isTurnBusy, selectLatestPlan, selectTranscriptTimeline } from '$lib';
	import { automaticSessionIcon } from '$lib/icon';
	import { applyPreferences, readPreferences } from '$lib/preferences';
	import type { CaptureInput } from '$lib/pwa/quick-capture';
	import { renderMessageMarkdown } from '$lib/message-markdown';
	import {
		applyLastSessionSelections,
		rememberLastSessionSelection
	} from '$lib/session-selections';
	import { formatWorkModeAnnouncement, type WorkMode } from '$lib/work-mode';
	import { createVoiceCall } from '$lib/voice/voice-call.svelte';
	import GlobalNavigation, { type GlobalView } from './GlobalNavigation.svelte';
	import AttentionCenter from './notifications/AttentionCenter.svelte';
	import HermesPanel from './HermesPanel.svelte';
	import ProjectBrowserDock from './ProjectBrowserDock.svelte';
	import ProjectFilesDock from './ProjectFilesDock.svelte';
	import ProjectWorkbench from './ProjectWorkbench.svelte';
	import HealthStrip from './workbench/HealthStrip.svelte';
	import ProjectTerminalDock from './workbench/ProjectTerminalDock.svelte';
	import QuickCapture from './pwa/QuickCapture.svelte';
	import Composer from './workspace/Composer.svelte';
	import ContextPanel from './workspace/ContextPanel.svelte';
	import Conversation from './workspace/Conversation.svelte';
	import { MessageState } from './workspace/message-state.svelte';
	import MobileNavigation from './workspace/MobileNavigation.svelte';
	import { MobileShellController } from './workspace/mobile-shell';
	import { compactModelLabel, type MobileGesture } from './workspace/mobile-navigation';
	import { readProjectPanels, togglePanelState as togglePanel } from './workspace/panel-state';
	import { workspaceApi } from './workspace/api';
	import { WorkspaceNavigation } from './workspace/navigation.svelte';
	import { isImageIcon, ProjectManagement } from './workspace/project-management.svelte';
	import ProjectRail from './workspace/ProjectRail.svelte';
	import SessionHeader from './workspace/SessionHeader.svelte';
	import SessionManagerOverlay from './workspace/SessionManagerOverlay.svelte';
	import SessionPaneGrid from './workspace/SessionPaneGrid.svelte';
	import ShellResizer from './workspace/ShellResizer.svelte';
	import WorkspaceWelcome from './workspace/WorkspaceWelcome.svelte';
	import DirtyGuardDialog from './workspace/DirtyGuardDialog.svelte';
	import { DirtyGuard } from './workspace/dirty-guard';
	import { installDirtyNavigation } from './workspace/dirty-navigation';
	import { RuntimeState } from './workspace/runtime-state.svelte';
	import { SessionState } from './workspace/session-state.svelte';
	import { TranscriptFollow } from './workspace/transcript-follow.svelte';
	import type { Project, Session, SessionLoad, WorkspaceProps } from './workspace/types';
	let {
		projects: initialProjects,
		projectsCapability = 'available',
		projectsError = '',
		reconciliationIssues = []
	}: WorkspaceProps = $props();
	let loading = $state(false),
		error = $state('');
	let globalView = $state<GlobalView | null>(null), unreadNotifications = $state(0);
	let now = $state(Date.now());
	let dirtyGuardOpen = $state(false),
		dirtyGuardDirty = $state(false);
	let mobile = $state(false), projectTools = $state(false), projectsPanelOpen = $state(true), sessionsPanelOpen = $state(true);
	let embedded = $derived(page.url.searchParams.get('embed') === 'chat');
	type ShellPane = 'projects' | 'sessions';
	let projectPaneWidth = $state(220),
		sessionPaneWidth = $state(320);
	let shellResize: { pane: ShellPane; x: number; width: number } | null = null;
	let workspaceElement: HTMLElement;
	let projectDrawerElement = $state<HTMLElement>();
	let sessionDrawerElement = $state<HTMLElement>();
	let gestureActive = $state(false),
		gestureAction = $state<MobileGesture['action']>(null);
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
	const voiceRef: { current: ReturnType<typeof createVoiceCall> | null } = { current: null };
	const sessionState = new SessionState(
		() => navigationRef.current?.selectedProject ?? null,
		(message) => (error = message)
	);
	const transcriptFollow = new TranscriptFollow(() => sessionState.delivery);
	const messageState = new MessageState({
		api: workspaceApi,
		getProject: () => navigationRef.current?.selectedProject ?? null,
		getSession: () => navigationRef.current?.selectedSession ?? null,
		getNavigation: () => navigationRef.current!,
		session: sessionState,
		transcriptFollow,
		prepareVoice: () => voiceRef.current?.prepareToSend(),
		applyVoiceEvents: (events, messageId) => voiceRef.current?.applyEvents(events, messageId),
		focusComposer: () => messageState.composerElement?.focus(),
		setError: (message) => (error = message),
		setLoading: (value) => (loading = value)
	});
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
			api: workspaceApi,
			getProjects: () => projectManagement.projects,
			endVoice: () => voiceRef.current?.end(false),
			cacheSession: () => sessionState.cache(navigationRef.current?.selectedSession ?? null),
			saveDraft: messageState.saveCurrentDraft,
			clearSession: () => {
				messageState.clear();
				sessionState.clear();
			},
			showCachedSession: sessionState.showCached,
			applyCreatedSession: async (body) => {
				messageState.clear();
				const selectedSession = navigation.selectedSession;
				if (!selectedSession) {
					sessionState.applyCreated(body);
					return;
				}
				const selections = await applyLastSessionSelections({
					storage: localStorage,
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
			applyLoadedSession: (body: SessionLoad) => {
				messageState.clear();
				sessionState.applyLoaded(body);
			},
			focusNotificationTarget: transcriptFollow.focusNotificationTarget,
			stopPolling: messageState.stopPolling,
			startPolling: messageState.startPolling,
			restoreDraft: messageState.restoreDraft,
			beginTranscriptEntryStick: transcriptFollow.begin,
			scrollToLatest: transcriptFollow.scrollToLatest,
			focusComposer: () => messageState.composerElement?.focus(),
			getDelivery: () => sessionState.delivery,
			sendText: messageState.sendText,
			setError: (message) => (error = message),
			setLoading: (value) => (loading = value),
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
	const runtimeState = new RuntimeState({
		api: workspaceApi,
		getSession: () => navigation.selectedSession,
		sessionPath: (sessionId) => navigation.sessionApiPath(sessionId),
		session: sessionState,
		setError: (message) => (error = message),
		rememberSelection: (selection) => rememberLastSessionSelection(localStorage, selection)
	});
	const voice = createVoiceCall({
		hasSession: () => navigation.selectedSession !== null,
		isBusy: () => isTurnBusy(sessionState.delivery),
		sendText: messageState.sendText,
		stopTurn: messageState.stopTurn,
		focusComposer: () => messageState.composerElement?.focus(),
		reportError: (message) => (error = message)
	});
	voiceRef.current = voice;
	let selectedProject = $derived(navigation.selectedProject);
	let panelProjectId = $derived(selectedProject?.id ?? '');
	let sessions = $derived(navigation.sessions);
	let workflows = $derived(navigation.workflows);
	let selectedSession = $derived(navigation.selectedSession);
	let timeline = $derived(sessionState.timeline);
	let hasTranscript = $derived(selectTranscriptTimeline(timeline).length > 0);
	let selectedPlan = $derived(selectLatestPlan(timeline));
	let commands = $derived(sessionState.commands);
	let runtime = $derived(sessionState.runtime);
	let branch = $derived(sessionState.branch);
	let queuedMessages = $derived(sessionState.queuedMessages);
	let delivery = $derived(sessionState.delivery);
	let composer = $derived(messageState.composer);
	let editingQueuedMessageId = $derived(messageState.editingQueuedMessageId);
	let workModeChanging = $state(false);
	let browserOpen = $state(true), filesOpen = $state(false);
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
		if (sessionPaneCount > 1 && innerWidth < 1600) browserOpen = false;
		terminalHeight = 300;
	});
	const changeWorkMode = async (workMode: WorkMode) => {
		if (!navigation.selectedSession || workModeChanging) return;
		workModeChanging = true;
		try {
			const body = await workspaceApi<{
				session: { sessionId: string; workMode: WorkMode };
				workMode: WorkMode;
				event?: import('./workspace/types').SessionEvent | null;
			}>(navigation.sessionApiPath(navigation.selectedSession.sessionId), {
				method: 'PATCH',
				body: JSON.stringify({ workMode })
			});
			navigation.replaceSession({
				...navigation.selectedSession,
				...body.session,
				workMode: body.workMode
			});
			rememberLastSessionSelection(localStorage, { workMode: body.workMode });
			messageState.messageNotice = formatWorkModeAnnouncement(body.workMode);
			if (body.event) sessionState.applyEvents([body.event]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			workModeChanging = false;
		}
	};
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
	async function submitDraft(event: SubmitEvent) {
		event.preventDefault();
		if (!navigation.selectedSession && !(await ensureDraftSession())) return;
		await messageState.submit(event);
	}
	onMount(() => {
		applyPreferences(document.documentElement, readPreferences(localStorage));
		for (const pane of ['projects', 'sessions'] as const) {
			const savedWidth = Number(localStorage.getItem(`hue:shell:${pane}:width`));
			if (savedWidth > 0) setShellPaneWidth(pane, savedWidth);
		}
		elapsedTimer = setInterval(() => (now = Date.now()), 1000);
		mobileShell = new MobileShellController({
			workspace: () => workspaceElement,
			drawer: (pane) => (pane === 'projects' ? projectDrawerElement : sessionDrawerElement)!,
			navigation,
			onMobile: (value) => (mobile = value),
			onVisual: (active, action) => ((gestureActive = active), (gestureAction = action))
		});
		mobileShell.start();
		return () => {
			mobileShell?.destroy();
			mobileShell = null;
			voice.end(false);
			messageState.stopPolling();
			if (elapsedTimer) clearInterval(elapsedTimer);
		};
	});
	installDirtyNavigation(dirtyGuard);
</script>

<svelte:window
	onkeydown={(event) =>
		event.key === 'Escape' && !document.querySelector('dialog[open]') && mobileShell?.close()}
	onbeforeunload={(event) => {
		if (dirtyGuardDirty) event.preventDefault();
	}}
/>
<div
	bind:this={workspaceElement}
	class="workspace grid h-dvh overflow-hidden bg-background text-foreground"
	class:ready={navigation.ready}
	class:drawer-gesture-active={gestureActive}
	class:gesture-reveal-projects={gestureAction === 'show-projects'}
	class:projects-panel-closed={!projectsPanelOpen} class:sessions-panel-closed={!sessionsPanelOpen}
	class:embedded
	style={`--project-pane-width: ${projectPaneWidth}px; --session-pane-width: ${sessionPaneWidth}px; --project-shell-color: ${selectedProject?.color ?? 'var(--background)'}`}
>
	<GlobalNavigation view={globalView} unreadCount={unreadNotifications} onview={setGlobalView} />
	<MobileNavigation
		drawer={navigation.mobileDrawer}
		ready={navigation.ready}
		backdrop={Boolean(navigation.mobileDrawer || gestureActive)}
		unreadCount={unreadNotifications}
		project={selectedProject}
		session={selectedSession}
		view={globalView}
		ontoggle={(pane, trigger) => mobileShell?.toggle(pane, trigger)}
		onclose={() => mobileShell?.close()}
		onnotifications={() => setGlobalView('notifications')}
		onsettings={() => setGlobalView('settings')}
	/>
	<AttentionCenter
		open={globalView === 'notifications'}
		projectId={selectedProject?.id ?? null}
		sessionId={selectedSession?.sessionId ?? null}
		onclose={() => setGlobalView(null)}
		oncounts={(count) => (unreadNotifications = count)}
	/>
	{#if globalView && globalView !== 'notifications'}<HermesPanel
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
		/>{/if}
	<ProjectRail
		bind:element={projectDrawerElement}
		open={navigation.mobileDrawer === 'projects'}
		{mobile}
		projects={projectManagement.projects}
		{selectedProject}
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
		onaddopen={projectManagement.openAddProject}
		onchoose={navigation.chooseProject}
		onlocate={projectManagement.openLocateProject}
		onedit={projectManagement.openEditProject}
		onicon={projectManagement.openProjectIcon}
		oniconselect={projectManagement.saveProjectIcon}
		oncolor={projectManagement.saveProjectColor}
		ongroup={projectManagement.saveProjectGroup}
		onhidden={projectManagement.toggleHiddenDirectories}
		ondirectory={projectManagement.loadDirectory}
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
		oncollapse={() => (projectsPanelOpen = false)}
		onclose={() => mobileShell?.close()}
		isImage={isImageIcon}
	/>
	<ContextPanel
		bind:element={sessionDrawerElement}
		open={navigation.mobileDrawer === 'sessions'}
		{mobile}
		{selectedProject}
		{loading}
		{sessions}
		{selectedSession}
		bind:sessionSearch={navigation.sessionSearch}
		bind:showArchived={navigation.showArchived}
		{now}
		oncreate={navigation.createSession}
		onopen={(session) => navigation.openSession(session, 'push')}
		onback={() => mobileShell?.open('projects')}
		onedit={navigation.openEditSession}
		onicon={navigation.openSessionIconEditor}
		onarchive={navigation.archiveSession}
		onsearch={navigation.searchSessionList}
		oncollapse={() => (sessionsPanelOpen = false)}
		onclose={() => mobileShell?.close()}
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
	{#if !mobile && !projectsPanelOpen}<nav class="collapsed-project-rail" aria-label="Collapsed Projects">
			<button
				aria-label="Show Projects panel"
				title="Show Projects panel"
				onclick={() => (projectsPanelOpen = true)}><FolderKanban size={17} aria-hidden="true" /></button
			>
			<button
				class:active={!selectedProject}
				aria-label="No project"
				aria-current={!selectedProject ? 'page' : undefined}
				title="No project"
				onclick={() => navigation.chooseProject(null)}><Diamond size={18} aria-hidden="true" /></button
			>
			{#each projectManagement.projects as project (project.id)}<button
					class:active={selectedProject?.id === project.id}
					aria-label={project.name}
					aria-current={selectedProject?.id === project.id ? 'page' : undefined}
					title={project.name}
					onclick={() => navigation.chooseProject(project)}
				>
					{#if isImageIcon(project.icon)}<img src={project.icon ?? ''} alt="" />{:else if project.icon}<span
							>{project.icon}</span
						>{:else}<Folder size={18} aria-hidden="true" />{/if}
				</button>{/each}
		</nav>{/if}
	{#if !mobile && !sessionsPanelOpen}<button
			class="panel-reopen-tab sessions"
			aria-label="Show Sessions panel"
			title="Show Sessions panel"
			onclick={() => (sessionsPanelOpen = true)}><List size={17} aria-hidden="true" /></button
		>{/if}
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
		class="session-workspace flex h-full min-h-0 min-w-0 overflow-hidden"
		class:terminal-open={terminalOpen && !mobile}
		style={`--terminal-panel-height: ${terminalHeight}px`}
	>
		<SessionPaneGrid
			{sessions}
			project={selectedProject}
			projectId={selectedProject?.id ?? null}
			{workflows}
			primarySession={selectedSession}
			allowDocking={!embedded}
			onpanecount={(count) => {
				sessionPaneCount = count;
				if (count > 1 && innerWidth < 1600) browserOpen = false;
			}}
			onprimaryclose={navigation.openSession}
			onsessionupdate={navigation.replaceSession}
			onrunworkflow={navigation.runWorkflow}
		>
			<main
				class="session-view flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
				class:empty-session={!hasTranscript}
			>
				<SessionHeader
					session={selectedSession}
					{runtime}
					contextPercent={runtimeState.contextPercent}
					onsessions={() => mobileShell?.open('sessions')}
					onicon={(event) =>
						selectedSession && navigation.openSessionIconEditor(event, selectedSession)}
					onmanage={(event) =>
						selectedSession && navigation.openEditSession(event, selectedSession)}
				/>
				{#if error}<div
						class="error mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2.5 text-sm text-destructive"
						role="alert"
					>
						{error}
					</div>{/if}
				{#if selectedProject?.rootAvailable && mobile}<button
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
							{dirtyGuard}
						/>
					{/key}
				{:else if selectedSession || (selectedProject?.rootAvailable && navigation.ready)}
					<Conversation
						{timeline}
						messageNotice={messageState.messageNotice}
						agentLabel={compactModelLabel(
							runtime.models?.currentModelId ?? '',
							runtimeState.currentModel()?.name ?? runtime.models?.currentModelId ?? 'Hermes'
						)}
						busy={isTurnBusy(delivery)}
						mediaPath={selectedSession
							? navigation.sessionApiPath(selectedSession.sessionId, '/media')
							: ''}
						renderMarkdown={renderMessageMarkdown}
						onedit={messageState.editMessage}
						oncopy={messageState.copyMessage}
						oncopycode={messageState.copyCode}
						oninteraction={messageState.respondToInteraction}
						onmedia={messageState.openMedia}
						onretrylast={messageState.retryLastResponse}
						bind:element={transcriptFollow.element}
						follow={transcriptFollow.follow}
					/>
					<Composer
						{composer}
						plan={selectedPlan}
						{timeline}
						renderMarkdown={renderMessageMarkdown}
						bind:composerElement={messageState.composerElement}
						bind:draggingImages={messageState.draggingImages}
						bind:images={messageState.images}
						bind:attachments={messageState.attachments}
						{delivery}
						pendingEnvelope={messageState.pendingEnvelope}
						{queuedMessages}
						{editingQueuedMessageId}
						commandIndex={messageState.commandIndex}
						callActive={voice.active}
						voiceMessageOnly={voice.messageOnly}
						callMuted={voice.muted}
						callStatus={voice.status}
						callError={voice.error}
						bind:voiceCancelElement={voice.cancelElement}
						bind:callMuteElement={voice.muteElement}
						bind:voiceMessageElement={voice.messageElement}
						bind:voiceStartElement={voice.startElement}
						{runtime}
						workMode={selectedSession?.workMode ?? 'autonomous'}
						{workModeChanging}
						runtimeChanging={runtimeState.changing}
						promptLibraryAvailable={Boolean(selectedProject?.rootAvailable)}
						{workflows}
						bind:workflowName={navigation.workflowName}
						bind:workflowPrompt={navigation.workflowPrompt}
						stopping={messageState.stopping}
						showScrollToLatest={timeline.length > 0 && transcriptFollow.showScrollToLatest}
						busy={isTurnBusy(delivery)}
						onsubmit={submitDraft}
						ondrop={messageState.handleDrop}
						onpaste={messageState.handlePaste}
						oninput={createSessionFromDraft}
						onkeydown={messageState.handleComposerKeydown}
						onimages={messageState.handleImageInput}
						onvoiceMessage={voice.startMessage}
						onvoiceCall={voice.startCall}
						onmute={voice.toggleMute}
						oninterrupt={voice.interrupt}
						onendcall={() => voice.end()}
						onstop={messageState.stopTurn}
						onretry={messageState.retryPendingMessage}
						oneditqueued={messageState.editQueuedMessage}
						oncommand={messageState.chooseCommand}
						onmodel={runtimeState.selectModel}
						onruntime={runtimeState.change}
						onconfig={runtimeState.changeConfig}
						onworkmode={changeWorkMode}
						onloadworkflows={navigation.loadWorkflows}
						onworkflow={navigation.addWorkflow}
						onrunworkflow={navigation.runWorkflow}
						onscrolllatest={transcriptFollow.scrollToLatest}
						matchingCommands={messageState.matchingCommands}
						contextPercent={runtimeState.contextPercent}
						showContextUsage={false}
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
		</SessionPaneGrid>
		{#if selectedProject?.rootAvailable && navigation.ready && !mobile}
			{#key selectedProject.id}
				<ProjectBrowserDock projectId={selectedProject.id} open={browserOpen}
					onpreviewchange={(url) => (previewUrl = url)} />
				<ProjectFilesDock projectId={selectedProject.id} open={filesOpen} {fileRequest}
					{dirtyGuard} />
				<ProjectWorkbench
					projectId={selectedProject.id} projectName={selectedProject.name} compact={false} docked={true}
					{browserOpen} {filesOpen} {terminalOpen}
					onpreviewchange={(url) => (previewUrl = url)}
					onbrowser={() => (browserOpen = togglePanel(localStorage, panelProjectId, 'browser', browserOpen))}
					onfiles={() => (filesOpen = togglePanel(localStorage, panelProjectId, 'files', filesOpen))}
					onopenfile={(path) => {
						fileRequest = { path, id: crypto.randomUUID() };
						if (!filesOpen) filesOpen = togglePanel(localStorage, panelProjectId, 'files', filesOpen);
					}}
					onterminal={() => (terminalOpen = togglePanel(localStorage, panelProjectId, 'terminal', terminalOpen))}
					onbranch={(value) => (branch = value)}
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
	{#if selectedProject && navigation.ready}
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
<SessionManagerOverlay {navigation} />
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
