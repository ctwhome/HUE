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

export function createSessionHistoryController(options: {
	api: Api;
	getSession: () => Session | null;
	getNavigation: () => WorkspaceNavigation;
	sessionState: SessionState;
	startPolling: () => void;
}) {
	let loading = $state(false);
	let error = $state('');
	let requestSelection = $state<ReturnType<WorkspaceNavigation['captureSessionSelection']>>(null);
	let attemptedSelection: typeof requestSelection = null;
	let abort: AbortController | null = null;
	let operation = 0;
	const current = () =>
		!!requestSelection && options.getNavigation().isCurrentSessionSelection(requestSelection);
	const loadFullHistory = async (): Promise<boolean> => {
		const navigation = options.getNavigation();
		const selection = navigation.captureSessionSelection();
		if (!selection || options.getSession()?.pending || (loading && current())) return false;
		abort?.abort();
		abort = new AbortController();
		const id = ++operation;
		requestSelection = selection;
		attemptedSelection = selection;
		loading = true;
		error = '';
		const origin = options.sessionState.captureLoad();
		try {
			const body = await options.api<SessionLoad>(
				navigation.sessionApiPath(selection.sessionId, '?history=full'),
				{
					signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)])
				}
			);
			if (id !== operation || !navigation.isCurrentSessionSelection(selection)) return false;
			options.sessionState.applyLoaded(body, origin);
			options.sessionState.cache(options.getSession());
			if (isTurnBusy(options.sessionState.delivery)) options.startPolling();
			error =
				body.transcriptError ??
				(body.history?.complete
					? ''
					: 'Older history is not available yet. Try again after the active turn finishes.');
			return !error;
		} catch (cause) {
			if (id === operation && navigation.isCurrentSessionSelection(selection))
				error = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			if (id === operation) loading = false;
		}
	};
	return {
		loadFullHistory,
		get historyLoading() {
			return loading && current();
		},
		get historyError() {
			return current() ? error : '';
		},
		hydrateEmptyHistory(): Promise<boolean> {
			if (loading && !current()) {
				operation++;
				abort?.abort();
				loading = false;
			}
			const state = options.sessionState;
			if (isTurnBusy(state.delivery) || state.delivery === 'delivery unknown') {
				attemptedSelection = null;
				return Promise.resolve(false);
			}
			if (
				options.getSession()?.harness !== 'opencode' ||
				!state.history ||
				state.history.complete ||
				state.timeline.some((item) => item.kind === 'message') ||
				(attemptedSelection &&
					options.getNavigation().isCurrentSessionSelection(attemptedSelection))
			)
				return Promise.resolve(false);
			return loadFullHistory();
		},
		dispose() {
			operation++;
			abort?.abort();
			loading = false;
		}
	};
}

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
		captureSelection: () => options.getNavigation().captureSessionSelection(),
		isCurrentSelection: (selection) =>
			!!selection &&
			options
				.getNavigation()
				.isCurrentSessionSelection(
					selection as NonNullable<ReturnType<WorkspaceNavigation['captureSessionSelection']>>
				),
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
	const historyController = createSessionHistoryController({
		...options,
		sessionState,
		startPolling: messageState.startPolling
	});
	$effect(() => {
		void historyController.hydrateEmptyHistory();
	});
	let workModeSelection = $state<ReturnType<WorkspaceNavigation['captureSessionSelection']>>(null);

	async function changeWorkMode(workMode: WorkMode) {
		const navigation = options.getNavigation();
		const selected = navigation.selectedSession;
		const selection = navigation.captureSessionSelection();
		if (
			!selected ||
			(workModeChanging &&
				workModeSelection &&
				navigation.isCurrentSessionSelection(workModeSelection))
		)
			return;
		workModeSelection = selection;
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
			if (!selection || !navigation.isCurrentSessionSelection(selection)) return;
			navigation.replaceSession({ ...selected, ...body.session, workMode: body.workMode });
			options.rememberSelection({ workMode: body.workMode });
			messageState.messageNotice = formatWorkModeAnnouncement(body.workMode);
			if (body.event) sessionState.previewEvents([body.event]);
		} catch (cause) {
			if (selection && navigation.isCurrentSessionSelection(selection))
				options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (selection && navigation.isCurrentSessionSelection(selection)) workModeChanging = false;
		}
	}

	onDestroy(() => {
		historyController.dispose();
		messageState.saveCurrentDraft();
		messageState.stopPolling();
		voice.end(false);
	});

	return {
		loadFullHistory: historyController.loadFullHistory,
		get historyLoading() {
			return historyController.historyLoading;
		},
		get historyError() {
			return historyController.historyError;
		},
		sessionState,
		transcriptFollow,
		messageState,
		runtimeState,
		voice,
		get workModeChanging() {
			return (
				workModeChanging &&
				!!workModeSelection &&
				options.getNavigation().isCurrentSessionSelection(workModeSelection)
			);
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
