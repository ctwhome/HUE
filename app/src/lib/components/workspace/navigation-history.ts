import {
	NAVIGATION_MEMORY_KEY,
	resolveNavigationDestination,
	type MobilePane
} from './mobile-navigation';
import type { Project, Session } from './types';

export type HistoryMode = 'push' | 'replace' | 'none';

type NavigationState = {
	ready: boolean;
	selectedProject: Project | null;
	selectedSession: Session | null;
	mobileDrawer: MobilePane;
	activeTab: 'sessions' | 'workflows';
	sessions: Session[];
	persistSelection: (mode?: Exclude<HistoryMode, 'none'>, drawerEntry?: boolean) => void;
	loadActiveTab: (sessionId?: string | null) => Promise<void>;
	openSession: (session: Session, mode?: HistoryMode) => Promise<boolean>;
};

type RestoreEffects = {
	getProjects: () => Project[];
	isMobile: () => boolean;
	endVoice: () => void;
	stopPolling: () => void;
	clearSession: () => void;
};

export function persistNavigationSelection(
	navigation: Pick<NavigationState, 'selectedProject' | 'selectedSession' | 'mobileDrawer'>,
	mode: Exclude<HistoryMode, 'none'> = 'replace',
	drawerEntry = false
) {
	const url = new URL(window.location.href);
	url.searchParams.set('project', navigation.selectedProject?.id ?? 'none');
	if (navigation.selectedSession)
		url.searchParams.set('session', navigation.selectedSession.sessionId);
	else url.searchParams.delete('session');
	if (navigation.mobileDrawer) url.searchParams.set('pane', navigation.mobileDrawer);
	else url.searchParams.delete('pane');
	window.history[mode === 'push' ? 'pushState' : 'replaceState'](
		{
			...(window.history.state ?? {}),
			hueWorkspace: true,
			drawerEntry,
			projectId: navigation.selectedProject?.id ?? null,
			sessionId: navigation.selectedSession?.sessionId ?? null,
			pane: navigation.mobileDrawer
		},
		'',
		url
	);
	localStorage.setItem(
		NAVIGATION_MEMORY_KEY,
		JSON.stringify({
			version: 1,
			projectId: navigation.selectedProject?.id ?? null,
			sessionId: navigation.selectedSession?.sessionId ?? null,
			pane: navigation.mobileDrawer
		})
	);
	document.title = navigation.selectedSession?.title
		? `${navigation.selectedSession.title} · HUE`
		: 'HUE';
}

export async function restoreNavigationSelection(
	navigation: NavigationState,
	effects: RestoreEffects
) {
	const destination = resolveNavigationDestination(
		new URL(window.location.href),
		localStorage.getItem(NAVIGATION_MEMORY_KEY),
		effects.getProjects().map(({ id }) => id)
	);
	if (
		navigation.ready &&
		destination.projectId === (navigation.selectedProject?.id ?? null) &&
		destination.sessionId === (navigation.selectedSession?.sessionId ?? null)
	) {
		navigation.mobileDrawer = effects.isMobile() ? destination.pane : null;
		navigation.persistSelection('replace');
		return;
	}
	navigation.ready = false;
	effects.endVoice();
	effects.stopPolling();
	navigation.selectedProject =
		destination.projectId === null
			? null
			: (effects.getProjects().find(({ id }) => id === destination.projectId) ?? null);
	navigation.selectedSession = null;
	effects.clearSession();
	navigation.activeTab = 'sessions';
	navigation.mobileDrawer = null;
	if (navigation.selectedProject?.rootAvailable === false) {
		navigation.persistSelection('replace');
		navigation.ready = true;
		return;
	}
	await navigation.loadActiveTab(destination.sessionId);
	const session = navigation.sessions.find(({ sessionId }) => sessionId === destination.sessionId);
	const sessionRestored = session ? await navigation.openSession(session, 'none') : false;
	if (destination.sessionId && !sessionRestored) {
		navigation.selectedSession = null;
		effects.clearSession();
	}
	navigation.mobileDrawer =
		effects.isMobile() && (!destination.sessionId || sessionRestored)
			? destination.pane
			: destination.sessionId && !sessionRestored
				? 'sessions'
				: null;
	navigation.persistSelection('replace');
	navigation.ready = true;
}
