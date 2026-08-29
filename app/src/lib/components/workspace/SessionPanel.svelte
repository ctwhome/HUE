<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { selectTranscriptTimeline } from '$lib';
	import { rememberLastSessionSelection } from '$lib/session-selections';
	import { WorkspaceNavigation } from './navigation.svelte';
	import { createSessionController } from './session-controller.svelte';
	import SessionSurface from './SessionSurface.svelte';
	import { workspaceApi } from './api';
	import {
		CHAT_BACKGROUND_EVENT,
		chatBackgroundStyle,
		resolveChatBackground,
		type ChatBackground
	} from './chat-background';
	import type { Project, Session, Workflow } from './types';

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
	const navigationRef: { current: WorkspaceNavigation | null } = { current: null };
	const sessionController = createSessionController({
		api: workspaceApi,
		getProject: () => fixedProject,
		getSession: () => navigationRef.current?.selectedSession ?? null,
		getNavigation: () => navigationRef.current!,
		setError: (message) => (error = message),
		setLoading: (value) => (loading = value),
		rememberSelection: (selection) => rememberLastSessionSelection(localStorage, selection),
		focusNotificationTarget: async () => false
	});
	const { sessionState, messageState } = sessionController;
	const navigation = new WorkspaceNavigation(fixedProject, {
		...sessionController.navigationEffects,
		api: workspaceApi,
		getProjects: () => (fixedProject ? [fixedProject] : []),
		adjustChatSessionCount: () => {},
		applyCreatedSession: () => {},
		guard: () => false,
		isMobile: () => false,
		openCapture: async () => {}
	});
	navigationRef.current = navigation;
	navigation.selectedProject = fixedProject;
	navigation.sessions = [fixedSession];
	navigation.selectedSession = fixedSession;
	navigation.ready = true;
	let panelSession = $derived(navigation.selectedSession);
	let timeline = $derived(sessionState.timeline);
	let hasTranscript = $derived(selectTranscriptTimeline(timeline).length > 0);
	let lastPublishedSession = fixedSession;
	let chatBackground = $state<ChatBackground | null>(null);

	$effect(() => {
		navigation.workflows = workflows;
	});
	$effect(() => {
		const updated = navigation.sessions.find(
			({ sessionId }) => sessionId === fixedSession.sessionId
		);
		if (updated && updated !== lastPublishedSession) {
			lastPublishedSession = updated;
			untrack(() => onupdate(updated));
		}
	});

	onMount(() => {
		const refreshChatBackground = () =>
			(chatBackground = resolveChatBackground(localStorage, fixedSession.sessionId));
		refreshChatBackground();
		window.addEventListener(CHAT_BACKGROUND_EVENT, refreshChatBackground);
		messageState.restoreDraft();
		void navigation.openSession(fixedSession, 'none');
		return () => {
			window.removeEventListener(CHAT_BACKGROUND_EVENT, refreshChatBackground);
		};
	});
</script>

<main
	class="session-view chat-background-surface flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	class:empty-session={!hasTranscript}
	class:personal-background={chatBackground !== null}
	style={chatBackgroundStyle(chatBackground)}
	aria-busy={loading}
>
	{#if error}<div
			class="error mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2.5 text-sm text-destructive"
			role="alert"
		>
			{error}
		</div>{/if}
	<SessionSurface
		controller={sessionController}
		{navigation}
		project={fixedProject}
		session={panelSession}
		workflows={navigation.workflows}
		sessionLabel={panelSession?.title || panelSession?.sessionId || 'Hermes Session'}
		mediaPath={navigation.sessionApiPath(fixedSession.sessionId, '/media')}
		onsubmit={messageState.submit}
		oninput={messageState.updateDraft}
		{onrunworkflow}
	/>
</main>
