import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';
import {
	NAVIGATION_MEMORY_KEY,
	resolveInitialMobilePane,
	resolveLaunchDestination,
	type LaunchDestination,
	type MobilePane
} from './mobile-navigation';
import type { Project, Session } from './types';

export type HistoryMode = 'push' | 'replace' | 'none';

export const isDrawerHistoryEntry = () =>
	Boolean(page.state.hueWorkspace && page.state.drawerEntry);

type NavigationState = {
	ready: boolean;
	selectedProject: Project | null;
	selectedSession: Session | null;
	mobileDrawer: MobilePane;
	activeTab: 'sessions' | 'workflows';
	sessions: Session[];
	persistSelection: (
		mode?: Exclude<HistoryMode, 'none'>,
		drawerEntry?: boolean,
		remember?: boolean
	) => void;
	loadActiveTab: (sessionId?: string | null) => Promise<void>;
	openSession: (session: Session, mode?: HistoryMode, launchEventId?: string | null) => Promise<boolean>;
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
	drawerEntry = false,
	remember = true
) {
	const url = new URL(window.location.href);
	url.searchParams.delete('intent');
	url.searchParams.delete('token');
	url.searchParams.delete('event');
	url.searchParams.set('project', navigation.selectedProject?.id ?? 'none');
	if (navigation.selectedSession)
		url.searchParams.set('session', navigation.selectedSession.sessionId);
	else url.searchParams.delete('session');
	if (navigation.mobileDrawer) url.searchParams.set('pane', navigation.mobileDrawer);
	else url.searchParams.delete('pane');
	(mode === 'push' ? pushState : replaceState)(url, {
		hueWorkspace: true,
		drawerEntry,
		projectId: navigation.selectedProject?.id ?? null,
		sessionId: navigation.selectedSession?.sessionId ?? null,
		pane: navigation.mobileDrawer
	});
	if (remember)
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
	effects: RestoreEffects,
	guard?: () => boolean
): Promise<LaunchDestination | null> {
	const url = new URL(window.location.href);
	const destination = resolveLaunchDestination(
		url,
		localStorage.getItem(NAVIGATION_MEMORY_KEY),
		effects.getProjects().map(({ id }) => id)
	);
	const notificationTarget = url.searchParams.has('event');
	const mobilePane = effects.isMobile() ? resolveInitialMobilePane(destination) : null;
	const sameWorkspace =
		!notificationTarget &&
		navigation.ready &&
		destination.projectId === (navigation.selectedProject?.id ?? null) &&
		destination.sessionId === (navigation.selectedSession?.sessionId ?? null);
	if (navigation.ready && !sameWorkspace && guard?.()) return null;
	if (sameWorkspace) {
		navigation.mobileDrawer = mobilePane;
		navigation.persistSelection(
			'replace',
			false,
			!['capture', 'share'].includes(destination.intent ?? '')
		);
		return destination;
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
		return destination;
	}
	// Shell and workbench stay usable while slower Session discovery continues.
	navigation.ready = true;
	await navigation.loadActiveTab(destination.sessionId);
	const session = navigation.sessions.find(({ sessionId }) => sessionId === destination.sessionId);
	const sessionRestored = session
		? await navigation.openSession(session, 'none', url.searchParams.get('event'))
		: false;
	if (destination.sessionId && !sessionRestored) {
		navigation.selectedSession = null;
		effects.clearSession();
	}
	if (destination.sessionId) await navigation.loadActiveTab(null);
	navigation.mobileDrawer =
		effects.isMobile() && (!destination.sessionId || sessionRestored)
			? mobilePane
			: destination.sessionId && !sessionRestored
				? 'sessions'
				: null;
	if (!notificationTarget)
		navigation.persistSelection(
			'replace',
			false,
			!['capture', 'share'].includes(destination.intent ?? '')
		);
	navigation.ready = true;
	return destination;
}
