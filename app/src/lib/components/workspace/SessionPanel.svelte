<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { isTurnBusy, selectLatestPlan } from '$lib';
	import { renderMessageMarkdown } from '$lib/message-markdown';
	import { rememberLastSessionSelection } from '$lib/session-selections';
	import { formatWorkModeAnnouncement, type WorkMode } from '$lib/work-mode';
	import { createVoiceCall } from '$lib/voice/voice-call.svelte';
	import Composer from './Composer.svelte';
	import Conversation from './Conversation.svelte';
	import { MessageState } from './message-state.svelte';
	import { compactModelLabel } from './mobile-navigation';
	import { WorkspaceNavigation } from './navigation.svelte';
	import { RuntimeState } from './runtime-state.svelte';
	import { SessionState } from './session-state.svelte';
	import { TranscriptFollow } from './transcript-follow.svelte';
	import { workspaceApi } from './api';
	import type { Project, Session, SessionLoad, Workflow } from './types';

	let {
		project,
		session,
		workflows,
		onupdate,
		onrunworkflow
	}: {
		project: Project | null;
		session: Session;
		workflows: Workflow[];
		onupdate: (session: Session) => void;
		onrunworkflow: (workflow: Workflow) => void;
	} = $props();
	const fixedProject = untrack(() => project);
	const fixedSession = untrack(() => session);
	let error = $state('');
	let loading = $state(false);
	let workModeChanging = $state(false);
	const navigationRef: { current: WorkspaceNavigation | null } = { current: null };
	const voiceRef: { current: ReturnType<typeof createVoiceCall> | null } = { current: null };
	const sessionState = new SessionState(
		() => fixedProject,
		(message) => (error = message)
	);
	const transcriptFollow = new TranscriptFollow(() => sessionState.delivery);
	const messageState = new MessageState({
		api: workspaceApi,
		getProject: () => fixedProject,
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
	const navigation = new WorkspaceNavigation(fixedProject, {
		api: workspaceApi,
		getProjects: () => (fixedProject ? [fixedProject] : []),
		endVoice: () => voiceRef.current?.end(false),
		cacheSession: () => sessionState.cache(navigation.selectedSession),
		saveDraft: messageState.saveCurrentDraft,
		clearSession: () => {
			messageState.clear();
			sessionState.clear();
		},
		showCachedSession: sessionState.showCached,
		applyCreatedSession: () => {},
		applyLoadedSession: (body: SessionLoad) => {
			messageState.clear();
			sessionState.applyLoaded(body);
		},
		focusNotificationTarget: async () => false,
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
		guard: () => false,
		isMobile: () => false,
		openCapture: async () => {}
	});
	navigationRef.current = navigation;
	navigation.selectedProject = fixedProject;
	navigation.sessions = [fixedSession];
	navigation.selectedSession = fixedSession;
	navigation.ready = true;
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
	let panelSession = $derived(navigation.selectedSession);
	let timeline = $derived(sessionState.timeline);
	let runtime = $derived(sessionState.runtime);

	$effect(() => {
		navigation.workflows = workflows;
	});
	$effect(() => {
		const updated = navigation.sessions.find(
			({ sessionId }) => sessionId === fixedSession.sessionId
		);
		if (updated) onupdate(updated);
	});

	async function changeWorkMode(workMode: WorkMode) {
		const selected = navigation.selectedSession;
		if (!selected || workModeChanging) return;
		workModeChanging = true;
		try {
			const body = await workspaceApi<{
				session: { sessionId: string; workMode: WorkMode };
				workMode: WorkMode;
				event?: import('./types').SessionEvent | null;
			}>(navigation.sessionApiPath(selected.sessionId), {
				method: 'PATCH',
				body: JSON.stringify({ workMode })
			});
			navigation.replaceSession({ ...selected, ...body.session, workMode: body.workMode });
			rememberLastSessionSelection(localStorage, { workMode: body.workMode });
			messageState.messageNotice = formatWorkModeAnnouncement(body.workMode);
			if (body.event) sessionState.applyEvents([body.event]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			workModeChanging = false;
		}
	}

	onMount(() => {
		messageState.restoreDraft();
		void navigation.openSession(fixedSession, 'none');
		return () => {
			messageState.saveCurrentDraft();
			messageState.stopPolling();
			voice.end(false);
		};
	});
</script>

<main
	class="session-view flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	class:empty-session={timeline.length === 0}
	aria-busy={loading}
>
	{#if error}<div
			class="error mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2.5 text-sm text-destructive"
			role="alert"
		>
			{error}
		</div>{/if}
	<Conversation
		{timeline}
		messageNotice={messageState.messageNotice}
		agentLabel={compactModelLabel(
			runtime.models?.currentModelId ?? '',
			runtimeState.currentModel()?.name ?? runtime.models?.currentModelId ?? 'Hermes'
		)}
		busy={isTurnBusy(sessionState.delivery)}
		mediaPath={navigation.sessionApiPath(fixedSession.sessionId, '/media')}
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
		composer={messageState.composer}
		plan={selectLatestPlan(timeline)}
		{timeline}
		renderMarkdown={renderMessageMarkdown}
		bind:composerElement={messageState.composerElement}
		bind:draggingImages={messageState.draggingImages}
		bind:images={messageState.images}
		bind:attachments={messageState.attachments}
		delivery={sessionState.delivery}
		pendingEnvelope={messageState.pendingEnvelope}
		queuedMessages={sessionState.queuedMessages}
		editingQueuedMessageId={messageState.editingQueuedMessageId}
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
		workMode={panelSession?.workMode ?? 'autonomous'}
		{workModeChanging}
		runtimeChanging={runtimeState.changing}
		promptLibraryAvailable={Boolean(fixedProject?.rootAvailable)}
		workflows={navigation.workflows}
		bind:workflowName={navigation.workflowName}
		bind:workflowPrompt={navigation.workflowPrompt}
		bind:modelMenuOpen={runtimeState.modelMenuOpen}
		bind:modelPopover={runtimeState.modelPopover}
		stopping={messageState.stopping}
		showScrollToLatest={timeline.length > 0 && transcriptFollow.showScrollToLatest}
		busy={isTurnBusy(sessionState.delivery)}
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
		onloadworkflows={navigation.loadWorkflows}
		onworkflow={navigation.addWorkflow}
		{onrunworkflow}
		onscrolllatest={transcriptFollow.scrollToLatest}
		matchingCommands={messageState.matchingCommands}
		currentModel={runtimeState.currentModel}
		modelCategories={runtimeState.modelCategories}
		contextPercent={runtimeState.contextPercent}
	/>
</main>
