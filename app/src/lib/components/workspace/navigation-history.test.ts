import { afterEach, expect, mock, test } from 'bun:test';
import type { ExternalCronJob, Project, Session } from './types';

mock.module('$app/navigation', () => ({ pushState() {}, replaceState() {} }));
mock.module('$app/state', () => ({ page: { state: {} } }));
const { restoreNavigationSelection } = await import('./navigation-history');
const { MobileShellController } = await import('./mobile-shell');

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
	if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
	else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('mobile shell can install interactions without restoring before Projects resolve', () => {
	let restores = 0;
	let gestures = 0;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { addEventListener() {} }
	});
	const shell = {
		syncMobile() {},
		query: { addEventListener() {} },
		restoreHistory() {},
		gesture: {
			start() {
				gestures++;
			}
		},
		options: {
			navigation: {
				restoreSelection: async () => {
					restores++;
					return true;
				}
			}
		}
	};
	MobileShellController.prototype.start.call(shell as never, false);
	expect(gestures).toBe(1);
	expect(restores).toBe(0);
	MobileShellController.prototype.start.call(shell as never);
	expect(restores).toBe(1);
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
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [],
		persistSelection() {
			persistedSessionId = this.selectedSession?.sessionId ?? null;
		},
		async loadActiveTab(sessionId?: string | null) {
			if (sessionId === null) expect(this.selectedSession).toBeNull();
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
	expect(persistedSessionId).toBeUndefined();
	expect(cleared).toBe(2);
	expect(loads).toEqual(['deleted-session', null]);
});

test('a late restore cannot clear a newer selection or persist over its URL', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { href: 'http://hue.local/?project=none&session=old' } }
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	let resolve!: () => void;
	const pending = new Promise<void>((done) => (resolve = done));
	let persisted = 0;
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [],
		persistSelection() {
			persisted++;
		},
		loadActiveTab: () => pending,
		async openSession() {
			return false;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];
	const restore = restoreNavigationSelection(navigation, {
		getProjects: () => [],
		isMobile: () => false,
		endVoice() {},
		stopPolling() {},
		clearSession() {}
	});
	navigation.selectedSession = { sessionId: 'new', cwd: '/work' };
	resolve();
	expect(await restore).toBeNull();
	expect(navigation.selectedSession.sessionId).toBe('new');
	expect(persisted).toBe(0);
	expect(navigation.ready).toBe(true);
});

test('deep-link restore returns ready while full discovery remains pending', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { href: 'http://hue.local/?project=none&session=known' } }
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	let resolve!: () => void;
	const discovery = new Promise<void>((done) => (resolve = done));
	const known = { sessionId: 'known', cwd: '/work' };
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [],
		persistSelection() {},
		async loadActiveTab(target?: string | null) {
			if (target) this.sessions = [known];
			else await discovery;
		},
		async openSession(session: Session) {
			this.selectedSession = session;
			return true;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];
	await restoreNavigationSelection(navigation, {
		getProjects: () => [],
		isMobile: () => false,
		endVoice() {},
		stopPolling() {},
		clearSession() {}
	});
	expect(navigation.selectedSession).toEqual(known);
	expect(navigation.ready).toBe(true);
	resolve();
});

test('repeated unresolved Project restores never replace the deep link with Chats', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { href: 'http://hue.local/?project=missing&session=known' } }
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	let persisted = 0;
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [],
		persistSelection() {
			persisted++;
		},
		async loadActiveTab() {},
		async openSession() {
			return false;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];
	const effects = {
		getProjects: () => [],
		isMobile: () => false,
		endVoice() {},
		stopPolling() {},
		clearSession() {}
	};
	await restoreNavigationSelection(navigation, effects);
	await restoreNavigationSelection(navigation, effects);
	expect(persisted).toBe(0);
	expect(navigation.ready).toBe(true);
});

test('restored mobile lists are visible before discovery completes', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { location: { href: 'http://hue.local/?project=none&pane=sessions' } }
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	let resolve!: () => void;
	const discovery = new Promise<void>((done) => (resolve = done));
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [],
		persistSelection() {},
		loadActiveTab: () => discovery,
		async openSession() {
			return false;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];
	const restoring = restoreNavigationSelection(navigation, {
		getProjects: () => [],
		isMobile: () => true,
		endVoice() {},
		stopPolling() {},
		clearSession() {}
	});
	expect(navigation.ready).toBe(true);
	expect(navigation.mobileDrawer).toBe('sessions');
	resolve();
	await restoring;
});

test('restores an external cron run notification target', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			location: {
				href: 'http://hue.local/?project=none&collection=cron&cronProfile=default&cronJob=job-1&cronRun=run-1'
			}
		}
	});
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: () => null }
	});
	const job = { profile: 'default', jobId: 'job-1', name: 'Daily review' } as ExternalCronJob;
	const navigation = {
		ready: false,
		selectedProject: null,
		selectedSession: null,
		selectedExternalCronJob: null,
		mobileDrawer: null,
		activeTab: 'sessions',
		sessionCollection: 'chats',
		sessions: [],
		externalCronJobs: [] as ExternalCronJob[],
		persistSelection() {},
		async loadActiveTab() {
			this.externalCronJobs = [job];
		},
		async openSession() {
			return false;
		}
	} as Parameters<typeof restoreNavigationSelection>[0];

	await restoreNavigationSelection(navigation, {
		getProjects: () => [],
		isMobile: () => false,
		endVoice: () => undefined,
		stopPolling: () => undefined,
		clearSession: () => undefined
	});

	expect(navigation.sessionCollection).toBe('cron');
	expect(navigation.selectedExternalCronJob).toBe(job);
});
