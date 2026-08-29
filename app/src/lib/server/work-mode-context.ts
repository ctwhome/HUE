import {
	DEFAULT_WORK_MODE,
	detectWorkModeSwitch,
	parseWorkMode,
	type WorkMode
} from '$lib/work-mode';
import type { HUEStore, SessionEvent, StoredSession } from './store';
import type { MessageDispatcher, MessageEnvelope } from './message-dispatcher';

export function currentWorkMode(
	store: HUEStore,
	projectId: string | null,
	sessionId: string
): WorkMode {
	return (store.getSession(projectId, sessionId)?.workMode ?? DEFAULT_WORK_MODE) as WorkMode;
}

export function applyMessageWorkMode(
	store: HUEStore,
	projectId: string | null,
	sessionId: string,
	text: string,
	hasAttachments = false
): { workMode: WorkMode; consumed: boolean; changed: boolean; event: SessionEvent | null } {
	const detected = detectWorkModeSwitch(text);
	const current = currentWorkMode(store, projectId, sessionId);
	if (!detected) return { workMode: current, consumed: false, changed: false, event: null };
	if (detected.consumed && hasAttachments) {
		throw new Error('Work mode commands cannot include attachments');
	}
	const updated = store.updateSessionWorkMode(
		projectId,
		sessionId,
		detected.workMode,
		detected.source,
		true
	);
	return {
		workMode: updated.session.workMode,
		consumed: detected.consumed,
		changed: updated.session.workMode !== current,
		event: updated.event
	};
}

export function acceptMessageWorkMode(
	store: HUEStore,
	envelope: MessageEnvelope,
	hasAttachments: boolean
) {
	const detected = detectWorkModeSwitch(envelope.text);
	if (!detected?.consumed) return null;
	if (hasAttachments) throw new Error('Work mode commands cannot include attachments');
	return store.database.transaction(() => {
		const accepted = store.acceptMessage(envelope);
		if (accepted.duplicate) {
			return {
				...accepted,
				workMode: detected.workMode,
				workModeChanged: false,
				workModeEvent: null,
				consumed: true
			};
		}
		const workMode = applyMessageWorkMode(
			store,
			envelope.projectId,
			envelope.sessionId,
			envelope.text,
			false
		);
		store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
		store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
		return {
			duplicate: false,
			status: 'completed' as const,
			workMode: workMode.workMode,
			workModeChanged: workMode.changed,
			workModeEvent: workMode.event,
			consumed: true
		};
	})();
}

export function submitMessageWithWorkMode(
	store: HUEStore,
	dispatcher: MessageDispatcher,
	envelope: MessageEnvelope,
	hasAttachments: boolean
) {
	const command = acceptMessageWorkMode(store, envelope, hasAttachments);
	if (command) return command;
	const result = store.database.transaction(() => {
		const accepted = store.acceptMessage(envelope);
		if (accepted.duplicate) {
			return {
				accepted,
				workMode: currentWorkMode(store, envelope.projectId, envelope.sessionId),
				changed: false,
				event: null
			};
		}
		const workMode = applyMessageWorkMode(
			store,
			envelope.projectId,
			envelope.sessionId,
			envelope.text,
			hasAttachments
		);
		return { accepted, ...workMode };
	})();
	return {
		...dispatcher.submitAccepted(envelope, result.accepted),
		workMode: result.workMode,
		workModeChanged: result.changed,
		workModeEvent: result.event
	};
}

export function applyExplicitWorkMode(
	store: HUEStore,
	projectId: string | null,
	sessionId: string,
	value: unknown,
	source: string
): { session: StoredSession; event: SessionEvent | null } {
	const workMode = parseWorkMode(value);
	if (!workMode) throw new Error('workMode must be autonomous or live');
	return store.updateSessionWorkMode(projectId, sessionId, workMode, source, true);
}
