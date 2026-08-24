import { afterEach, expect, test } from 'bun:test';
import { restoreNavigationSelection } from './navigation-history';
import type { Project, Session } from './types';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
	if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
	else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('failed unavailable or deleted Session restoration leaves Session list recovery open', async () => {
	const project = { id: 'project-1', rootAvailable: true } as Project;
	const session = {
		sessionId: 'deleted-session',
		cwd: '/work/hue',
		title: 'Deleted Session'
	} as Session;
	let persistedSessionId: string | null | undefined;
	let cleared = 0;
	const loads: Array<string | null | undefined> = [];
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { href: 'http://hue.local/?project=project-1&session=deleted-session' } }
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessions: [],
		persistSelection() {
			persistedSessionId = this.selectedSession?.sessionId ?? null;
		},
		async loadActiveTab(sessionId?: string | null) {
			loads.push(sessionId);
			this.sessions = [session];
		},
		async openSession(selected: Session) {
			this.selectedSession = selected;
			return false;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];

	await restoreNavigationSelection(navigation, {
		getProjects: () => [project],
		isMobile: () => true,
		endVoice: () => undefined,
		stopPolling: () => undefined,
		clearSession: () => cleared++
	});

	expect(navigation.selectedSession).toBeNull();
	expect(navigation.mobileDrawer).toBe('sessions');
	expect(persistedSessionId).toBeNull();
	expect(cleared).toBe(2);
	expect(loads).toEqual(['deleted-session', null]);
});
