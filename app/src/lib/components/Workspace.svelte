<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { Circle } from 'lucide-svelte';
	import { formatElapsed, isTurnBusy } from '$lib';
	import { automaticSessionIcon } from '$lib/icon';
	import { applyPreferences, readPreferences } from '$lib/preferences';
	import { renderMessageMarkdown } from '$lib/message-markdown';
	import { formatWorkModeAnnouncement, type WorkMode } from '$lib/work-mode';
	import { createVoiceCall } from '$lib/voice/voice-call.svelte';
	import GlobalNavigation, { type GlobalView } from './GlobalNavigation.svelte';
	import HermesPanel from './HermesPanel.svelte';
	import ProjectWorkbench from './ProjectWorkbench.svelte';
	import Composer from './workspace/Composer.svelte';
	import ContextPanel from './workspace/ContextPanel.svelte';
	import Conversation from './workspace/Conversation.svelte';
	import { MessageState } from './workspace/message-state.svelte';
	import { workspaceApi } from './workspace/api';
	import { WorkspaceNavigation } from './workspace/navigation.svelte';
	import { isImageIcon, ProjectManagement } from './workspace/project-management.svelte';
	import ProjectRail from './workspace/ProjectRail.svelte';
	import DirtyGuardDialog from './workspace/DirtyGuardDialog.svelte';
	import { DirtyGuard } from './workspace/dirty-guard';
	import { RuntimeState } from './workspace/runtime-state.svelte';
	import { SessionState } from './workspace/session-state.svelte';
	import { TranscriptFollow } from './workspace/transcript-follow.svelte';
	import type { Project, SessionLoad, WorkspaceProps } from './workspace/types';

	let {
		projects: initialProjects,
		projectsCapability = 'available',
		projectsError = '',
		reconciliationIssues = []
	}: WorkspaceProps = $props();
	let loading = $state(false);
	let error = $state('');
	let globalView = $state<GlobalView | null>(null);
	let now = $state(Date.now());
	let dirtyGuardOpen = $state(false);
	let dirtyGuardDirty = $state(false);
	const dirtyGuard = new DirtyGuard((guard) => {
		dirtyGuardOpen = guard.open;
		dirtyGuardDirty = guard.dirty;
	});
	function guarded(action: () => void) {
		if (!dirtyGuard.block(action)) action();
	}
	const setGlobalView = (view: GlobalView | null) => guarded(() => (globalView = view));
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
			applyCreatedSession: (body) => {
				messageState.clear();
				sessionState.applyCreated(body);
			},
			applyLoadedSession: (body: SessionLoad) => {
				messageState.clear();
				sessionState.applyLoaded(body);
			},
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
			guard: (action) => dirtyGuard.block(action)
		}
	);
	navigationRef.current = navigation;
	const runtimeState = new RuntimeState({
		api: workspaceApi,
		getSession: () => navigation.selectedSession,
		sessionPath: (sessionId) => navigation.sessionApiPath(sessionId),
		session: sessionState,
		setError: (message) => (error = message)
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
	let sessions = $derived(navigation.sessions);
	let workflows = $derived(navigation.workflows);
	let selectedSession = $derived(navigation.selectedSession);
	let activeTab = $derived(navigation.activeTab);
	let timeline = $derived(sessionState.timeline);
	let commands = $derived(sessionState.commands);
	let runtime = $derived(sessionState.runtime);
	let branch = $derived(sessionState.branch);
	let queuedMessages = $derived(sessionState.queuedMessages);
	let pendingAssistant = $derived(sessionState.pendingAssistant);
	let pendingImages = $derived(sessionState.pendingImages);
	let pendingThought = $derived(sessionState.pendingThought);
	let delivery = $derived(sessionState.delivery);
	let composer = $derived(messageState.composer);
	let pendingEnvelope = $derived(messageState.pendingEnvelope);
	let editingQueuedMessageId = $derived(messageState.editingQueuedMessageId);
	let commandIndex = $derived(messageState.commandIndex);
	let messageNotice = $derived(messageState.messageNotice);
	let runtimeChanging = $derived(runtimeState.changing);
	let stopping = $derived(messageState.stopping);
	let workModeChanging = $state(false);

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
			messageState.messageNotice = formatWorkModeAnnouncement(body.workMode);
			if (body.event) sessionState.applyEvents([body.event]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			workModeChanging = false;
		}
	};

	onMount(async () => {
		applyPreferences(document.documentElement, readPreferences(localStorage));
		elapsedTimer = setInterval(() => (now = Date.now()), 1000);
		await navigation.restoreSelection();
	});
	onDestroy(() => {
		voice.end(false);
		messageState.stopPolling();
		if (elapsedTimer) clearInterval(elapsedTimer);
	});
	beforeNavigate((navigation) => {
		if (!navigation.to || !dirtyGuard.dirty) return;
		navigation.cancel();
		const target = navigation.to.url;
		const internal = Boolean(navigation.to.route.id);
		dirtyGuard.block(() => {
			if (internal) void goto(target);
			else window.location.assign(target);
		});
	});
</script>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && (navigation.mobileDrawer = null)}
	onbeforeunload={(event) => {
		if (dirtyGuardDirty) event.preventDefault();
	}}
/>

<div
	class="workspace grid h-dvh grid-cols-[56px_220px_320px_minmax(0,1fr)] overflow-hidden bg-background text-foreground"
>
	<GlobalNavigation view={globalView} onview={setGlobalView} />
	<nav class="mobile-navigation" aria-label="Workspace navigation">
		<button
			aria-controls="project-drawer"
			aria-expanded={navigation.mobileDrawer === 'projects'}
			title="Projects"
			onclick={() =>
				(navigation.mobileDrawer = navigation.mobileDrawer === 'projects' ? null : 'projects')}
			>Projects</button
		>
		<button
			aria-controls="session-drawer"
			aria-expanded={navigation.mobileDrawer === 'sessions'}
			title="Sessions"
			onclick={() =>
				(navigation.mobileDrawer = navigation.mobileDrawer === 'sessions' ? null : 'sessions')}
			>Sessions</button
		>
		<button aria-label="Settings" title="Settings" onclick={() => setGlobalView('settings')}
			>Settings</button
		>
	</nav>
	{#if globalView}<HermesPanel
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
	{#if navigation.mobileDrawer}<button
			class="drawer-backdrop"
			aria-label="Close navigation"
			title="Close navigation"
			onclick={() => (navigation.mobileDrawer = null)}
		></button>{/if}
	<ProjectRail
		open={navigation.mobileDrawer === 'projects'}
		projects={projectManagement.projects}
		{selectedProject}
		{projectsCapability}
		{projectsError}
		{reconciliationIssues}
		bind:addProjectDialog={projectManagement.addProjectDialog}
		bind:editProjectDialog={projectManagement.editProjectDialog}
		bind:removeProjectDialog={projectManagement.removeProjectDialog}
		editingProject={projectManagement.editingProject}
		projectRoot={projectManagement.projectRoot}
		projectDirectories={projectManagement.projectDirectories}
		projectDirectoryParent={projectManagement.projectDirectoryParent}
		showHiddenDirectories={projectManagement.showHiddenDirectories}
		directoryLoading={projectManagement.directoryLoading}
		directoryError={projectManagement.directoryError}
		bind:projectName={projectManagement.projectName}
		bind:projectIcon={projectManagement.projectIcon}
		bind:projectEmojiPickerOpen={projectManagement.projectEmojiPickerOpen}
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
		isImage={isImageIcon}
	/>
	<ContextPanel
		open={navigation.mobileDrawer === 'sessions'}
		{selectedProject}
		{loading}
		{activeTab}
		{sessions}
		{selectedSession}
		{workflows}
		bind:workflowName={navigation.workflowName}
		bind:workflowPrompt={navigation.workflowPrompt}
		bind:editSessionDialog={navigation.editSessionDialog}
		editingSession={navigation.editingSession}
		bind:sessionIcon={navigation.sessionIcon}
		bind:sessionTitle={navigation.sessionTitle}
		bind:sessionPinned={navigation.sessionPinned}
		bind:sessionArchived={navigation.sessionArchived}
		bind:sessionFolder={navigation.sessionFolder}
		bind:sessionTags={navigation.sessionTags}
		bind:sessionSearch={navigation.sessionSearch}
		bind:showArchived={navigation.showArchived}
		bind:sessionEmojiPickerOpen={navigation.sessionEmojiPickerOpen}
		sessionEditError={navigation.sessionEditError}
		sessionSaving={navigation.sessionSaving}
		archivingSessionId={navigation.archivingSessionId}
		{now}
		oncreate={navigation.createSession}
		ontab={navigation.changeTab}
		onopen={navigation.openSession}
		onarchive={navigation.archiveSession}
		onedit={navigation.openEditSession}
		onrun={navigation.runWorkflow}
		onworkflow={navigation.addWorkflow}
		onimage={navigation.chooseSessionImage}
		onsave={navigation.saveSession}
		onsearch={navigation.searchSessionList}
		onduplicate={navigation.duplicateSession}
		ondelete={navigation.deleteSession}
		onexport={navigation.exportSession}
		isImage={isImageIcon}
		iconPreview={navigation.sessionIconPreview}
		automaticIcon={automaticSessionIcon}
		elapsed={formatElapsed}
	/>

	<main class="session-view flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
		<header
			class="session-header flex min-h-[76px] items-center justify-between border-b border-border px-5 py-3.5"
		>
			<div>
				<small>
					{selectedProject?.primaryPath ?? 'No project'}
					{#if branch}<span class="header-branch">{branch}</span>{/if}
				</small>
				<h2 class="selected-session-title mt-1 flex items-center gap-2 font-semibold">
					{#if selectedSession}{#if isImageIcon(selectedSession.icon ?? null)}<img
								class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
								src={selectedSession.icon ?? ''}
								alt=""
							/>
						{:else}<span
								class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
								>{selectedSession.icon ?? automaticSessionIcon(selectedSession.title)}</span
							>{/if}{/if}<span
						>{selectedSession?.title ||
							(selectedSession
								? 'New Hermes Session'
								: selectedProject
									? 'Project workbench'
									: 'Projects · Workflows · Sessions')}</span
					>
				</h2>
			</div>
			<div
				class="runtime-pill rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
				title={runtime.clarify?.reason ??
					`Clarify elicitation ${runtime.clarify?.status ?? 'unsupported'}`}
			>
				<Circle size={7} fill="currentColor" aria-hidden="true" /> Hermes ACP · Clarify {runtime
					.clarify?.status ?? 'unsupported'}
			</div>
		</header>
		{#if error}<div
				class="error mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2.5 text-sm text-destructive"
				role="alert"
			>
				{error}
			</div>{/if}
		{#if selectedSession}
			<Conversation
				{timeline}
				{messageNotice}
				busy={isTurnBusy(delivery)}
				mediaPath={navigation.sessionApiPath(selectedSession.sessionId, '/media')}
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
				bind:composerElement={messageState.composerElement}
				bind:draggingImages={messageState.draggingImages}
				bind:images={messageState.images}
				bind:attachments={messageState.attachments}
				{delivery}
				{pendingEnvelope}
				{queuedMessages}
				{editingQueuedMessageId}
				{commandIndex}
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
				workMode={selectedSession.workMode ?? 'autonomous'}
				{workModeChanging}
				{runtimeChanging}
				bind:modelMenuOpen={runtimeState.modelMenuOpen}
				bind:modelPopover={runtimeState.modelPopover}
				{stopping}
				showScrollToLatest={transcriptFollow.showScrollToLatest}
				busy={isTurnBusy(delivery)}
				onsubmit={messageState.submit}
				ondrop={messageState.handleDrop}
				onpaste={messageState.handlePaste}
				oninput={messageState.updateDraft}
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
				onworkmode={changeWorkMode}
				onscrolllatest={transcriptFollow.scrollToLatest}
				matchingCommands={messageState.matchingCommands}
				currentModel={runtimeState.currentModel}
				modelCategories={runtimeState.modelCategories}
				contextPercent={runtimeState.contextPercent}
			/>
		{:else if selectedProject && !selectedProject.rootAvailable}
			<section
				class="mx-auto mt-[12vh] grid max-w-xl gap-4 p-8 text-center text-muted-foreground"
				aria-label="Project folder unavailable"
			>
				<h2 class="text-foreground">Project folder unavailable</h2>
				<p>
					Primary folder {selectedProject.primaryPath} is unavailable. Choose an available Project folder
					as primary before opening Sessions, Git, terminal, or preview tools.
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					<button
						class="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
						onclick={() => projectManagement.openEditProject(null, selectedProject)}
						>Manage folders</button
					>
					<button
						class="min-h-11 rounded-md border border-border px-4"
						onclick={() => projectManagement.requestRemoveStaleProject(selectedProject)}
						>Archive</button
					>
					<button
						class="min-h-11 rounded-md border border-border px-4"
						onclick={() => navigation.chooseProject(null)}>Open without Project</button
					>
				</div>
			</section>
		{:else if selectedProject}
			{#key selectedProject.id}
				<ProjectWorkbench
					projectId={selectedProject.id}
					projectName={selectedProject.name}
					onbranch={(value) => (branch = value)}
					{dirtyGuard}
				/>
			{/key}
		{:else}
			<section class="hero mx-auto mt-[12vh] max-w-2xl p-8 text-center text-muted-foreground">
				<div
					class="hero-mark mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-violet-700 font-black text-violet-950 shadow-lg"
				>
					H
				</div>
				<h2>
					{projectManagement.projects.length
						? 'Projects · Workflows · Sessions'
						: 'Start your first HUE workspace'}
				</h2>
				<p>
					{projectManagement.projects.length
						? 'Choose a Project, or continue without one for a general Hermes Session.'
						: 'Add a trusted local folder for project work, or start a private projectless Session.'}
				</p>
				<div class="mt-5 flex flex-wrap justify-center gap-2">
					<button
						class="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
						disabled={projectsCapability !== 'available'}
						title={projectsCapability === 'available' ? 'Add Project' : projectsError}
						onclick={projectManagement.openAddProject}>Add Project</button
					>
					<button
						class="min-h-11 rounded-md border border-border px-4"
						onclick={navigation.createProjectlessSession}>Start without Project</button
					>
				</div>
				<div class="principles mt-6 flex flex-wrap justify-center gap-2">
					<span>Local SQLite</span><span>ACP v1</span><span>Project terminals</span><span
						>Reconnect cursors</span
					>
				</div>
			</section>
		{/if}
	</main>
</div>

<DirtyGuardDialog
	open={dirtyGuardOpen}
	onkeep={() => dirtyGuard.keepEditing()}
	ondiscard={() => dirtyGuard.discardAndContinue()}
/>
