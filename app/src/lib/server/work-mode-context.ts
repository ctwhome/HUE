import {
	DEFAULT_WORK_MODE,
	detectWorkModeSwitch,
	parseWorkMode,
	type WorkMode
} from '$lib/work-mode';
import type { HUEStore, SessionEvent, StoredSession } from './store';

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
	text: string
): { workMode: WorkMode; consumed: boolean; changed: boolean; event: SessionEvent | null } {
	const detected = detectWorkModeSwitch(text);
	const current = currentWorkMode(store, projectId, sessionId);
	if (!detected)
		return { workMode: current, consumed: false, changed: false, event: null };
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
