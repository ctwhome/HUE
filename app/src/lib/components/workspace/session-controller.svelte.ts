import { onDestroy } from 'svelte';
import { isTurnBusy } from '$lib';
import type { LastSessionSelections } from '$lib/session-selections';
import { formatWorkModeAnnouncement, type WorkMode } from '$lib/work-mode';
import { createVoiceCall } from '$lib/voice/voice-call.svelte';
import { MessageState } from './message-state.svelte';
import type { WorkspaceNavigation } from './navigation.svelte';
import { RuntimeState } from './runtime-state.svelte';
import { SessionState } from './session-state.svelte';
import { TranscriptFollow } from './transcript-follow.svelte';
import type { Api, Project, Session, SessionLoad } from './types';

export function createSessionController(options: {
	api: Api;
	getProject: () => Project | null;
	getSession: () => Session | null;
	getNavigation: () => WorkspaceNavigation;
	setError: (message: string) => void;
	setLoading: (loading: boolean) => void;
	rememberSelection: (selection: LastSessionSelections) => void;
	focusNotificationTarget: (
		events: SessionLoad['events'],
		sourceEventId: string | null
	) => Promise<boolean>;
}) {
	const sessionState = new SessionState(options.getProject, options.setError);
	const transcriptFollow = new TranscriptFollow(() => sessionState.delivery);
	let messageState: MessageState;
	let voice: ReturnType<typeof createVoiceCall>;
	messageState = new MessageState({
		api: options.api,
		getProject: options.getProject,
		getSession: options.getSession,
		getNavigation: options.getNavigation,
		session: sessionState,
		transcriptFollow,
		prepareVoice: () => voice.prepareToSend(),
		applyVoiceEvents: (events, messageId) => voice.applyEvents(events, messageId),
		focusComposer: () => messageState.composerElement?.focus(),
		setError: options.setError,
		setLoading: options.setLoading
	});
	const runtimeState = new RuntimeState({
		api: options.api,
		getSession: options.getSession,
		sessionPath: (sessionId) => options.getNavigation().sessionApiPath(sessionId),
		session: sessionState,
		setError: options.setError,
		rememberSelection: options.rememberSelection
	});
	voice = createVoiceCall({
		hasSession: () => options.getSession() !== null,
		isBusy: () => isTurnBusy(sessionState.delivery),
		sendText: messageState.sendText,
		stopTurn: messageState.stopTurn,
		focusComposer: () => messageState.composerElement?.focus(),
		reportError: options.setError
	});
	let workModeChanging = $state(false);

	async function changeWorkMode(workMode: WorkMode) {
		const navigation = options.getNavigation();
		const selected = navigation.selectedSession;
		if (!selected || workModeChanging) return;
		workModeChanging = true;
		try {
			const body = await options.api<{
				session: { sessionId: string; workMode: WorkMode };
				workMode: WorkMode;
				event?: import('./types').SessionEvent | null;
			}>(navigation.sessionApiPath(selected.sessionId), {
				method: 'PATCH',
				body: JSON.stringify({ workMode })
			});
			navigation.replaceSession({ ...selected, ...body.session, workMode: body.workMode });
			options.rememberSelection({ workMode: body.workMode });
			messageState.messageNotice = formatWorkModeAnnouncement(body.workMode);
			if (body.event) sessionState.applyEvents([body.event]);
		} catch (cause) {
			options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			workModeChanging = false;
		}
	}

	onDestroy(() => {
		messageState.saveCurrentDraft();
		messageState.stopPolling();
		voice.end(false);
	});

	return {
		sessionState,
		transcriptFollow,
		messageState,
		runtimeState,
		voice,
		get workModeChanging() {
			return workModeChanging;
		},
		changeWorkMode,
		navigationEffects: {
			endVoice: () => voice.end(false),
			cacheSession: () => sessionState.cache(options.getSession()),
			saveDraft: messageState.saveCurrentDraft,
			clearSession: () => {
				messageState.clear();
				sessionState.clear();
			},
			clearSessionState: sessionState.clear,
			showCachedSession: sessionState.showCached,
			applyLoadedSession: (body: SessionLoad) => {
				messageState.clear();
				sessionState.applyLoaded(body);
			},
			focusNotificationTarget: options.focusNotificationTarget,
			stopPolling: messageState.stopPolling,
			startPolling: messageState.startPolling,
			restoreDraft: messageState.restoreDraft,
			beginTranscriptEntryStick: transcriptFollow.begin,
			scrollToLatest: transcriptFollow.scrollToLatest,
			focusComposer: () => messageState.composerElement?.focus(),
			getDelivery: () => sessionState.delivery,
			getRuntimeProfile: () => sessionState.runtime.profile,
			sendText: messageState.sendText,
			setError: options.setError,
			setLoading: options.setLoading
		}
	};
}

export type SessionController = ReturnType<typeof createSessionController>;
