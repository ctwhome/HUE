import { expect, mock, test } from 'bun:test';
import type { Api, ExternalCronJob, Project } from './types';

if (!('$state' in globalThis)) Object.assign(globalThis, { $state: <T>(value?: T) => value });
if (!('window' in globalThis)) {
	Object.assign(globalThis, {
		window: { location: { href: 'http://hue.local/' }, history: { back() {} } }
	});
}
if (!('localStorage' in globalThis)) Object.assign(globalThis, { localStorage: { setItem() {} } });
if (!('document' in globalThis)) Object.assign(globalThis, { document: { title: '' } });
mock.module('$app/navigation', () => ({ pushState() {}, replaceState() {} }));
mock.module('$app/state', () => ({ page: { state: {} } }));
const { WorkspaceNavigation } = await import('./navigation.svelte');

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

test('finder navigation stops when the selected Project changes during its load', async () => {
	const firstLoad = deferred<{ sessions: [] }>();
	const requests: string[] = [];
	const one = { id: 'one', rootAvailable: true } as Project;
	const two = { id: 'two', rootAvailable: true } as Project;
	const state = new WorkspaceNavigation(null, {
		api: (async (path: string) => {
			requests.push(path);
			if (path.startsWith('/api/projects/one/sessions')) return firstLoad.promise;
			return { sessions: [] };
		}) as Api,
		guard: () => false,
		isMobile: () => false,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {}
	} as never);

	const finderNavigation = state.openFinderSession(one, 'target');
	await Promise.resolve();
	await state.chooseProject(two, 'none');
	firstLoad.resolve({ sessions: [] });
	await finderNavigation;

	expect(state.selectedProject?.id).toBe('two');
	expect(requests).toEqual([
		'/api/projects/one/sessions?sessionId=target&cached=true',
		'/api/projects/two/sessions?cached=true',
		'/api/projects/two/sessions'
	]);
});

test('finder opens its cached target while full discovery is pending', async () => {
	const discovery = deferred<unknown>();
	const state = new WorkspaceNavigation(null, {
		api: (async (path: string) =>
			path.includes('sessionId=target')
				? { sessions: [{ sessionId: 'target', cwd: '/work' }], reconciliation: 'cached' }
				: discovery.promise) as Api,
		guard: () => false,
		isMobile: () => false,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {}
	} as never);
	state.activeTab = 'workflows';
	state.openSession = async (session) => {
		state.selectedSession = session;
		return true;
	};
	await state.openFinderSession({ id: 'one', rootAvailable: true } as Project, 'target');
	expect(state.selectedSession?.sessionId).toBe('target');
	expect(state.loadedSessionListProjectId).toBeUndefined();
	discovery.resolve({ sessions: [], reconciliation: 'complete', projectId: 'one' });
});

test('confirming a guarded finder navigation resumes opening the target, not only its Project', async () => {
	let resume!: () => void;
	let guarded = true;
	const state = new WorkspaceNavigation(null, {
		api: (async () => ({ sessions: [{ sessionId: 'target', cwd: '/work' }] })) as Api,
		guard: (action: () => void) => {
			if (guarded) resume = action;
			return guarded;
		},
		isMobile: () => false,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {}
	} as never);
	state.openSession = async (session) => {
		state.selectedSession = session;
		return true;
	};
	await state.openFinderSession({ id: 'one', rootAvailable: true } as Project, 'target');
	guarded = false;
	resume();
	for (let i = 0; i < 10; i++) await Promise.resolve();
	expect(state.selectedSession?.sessionId).toBe('target');
});

test('stale Session opening cannot skip a later Project drill-down', async () => {
	const scroll = deferred<void>();
	const one = { id: 'one', rootAvailable: true } as Project;
	const two = { id: 'two', rootAvailable: true } as Project;
	const session = { sessionId: 'old-session', title: 'Old Session' } as never;
	const state = new WorkspaceNavigation(one, {
		api: (async () => ({ sessions: [] })) as Api,
		guard: () => false,
		isMobile: () => true,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {},
		restoreDraft() {},
		showCachedSession() {},
		beginTranscriptEntryStick() {},
		scrollToLatest: () => scroll.promise
	} as never);
	state.mobileDrawer = 'sessions';

	const opening = state.openSession(session, 'none', '');
	await Promise.resolve();
	await state.chooseProject(two, 'none');
	scroll.resolve();
	await opening;

	expect(state.selectedProject?.id).toBe('two');
	expect(state.selectedSession).toBeNull();
	expect(state.mobileDrawer).toBe('sessions');
});

test('shows cached Session titles while Hermes refreshes them', async () => {
	const refresh = deferred<{
		sessions: Array<{ sessionId: string; cwd: string; title: string }>;
	}>();
	const requests: string[] = [];
	const project = { id: 'one', rootAvailable: true } as Project;
	const state = new WorkspaceNavigation(null, {
		api: (async (path: string) => {
			requests.push(path);
			if (path.endsWith('?cached=true')) {
				return { sessions: [{ sessionId: 'cached', cwd: '/work', title: 'Cached title' }] };
			}
			return refresh.promise;
		}) as Api,
		guard: () => false,
		isMobile: () => true,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {}
	} as never);

	const loading = state.chooseProject(project, 'none');
	await Promise.resolve();
	await Promise.resolve();
	expect(state.sessions).toEqual([{ sessionId: 'cached', cwd: '/work', title: 'Cached title' }]);
	expect(state.loadedSessionListProjectId).toBeUndefined();
	expect(state.mobileDrawer).toBe('sessions');
	expect(requests).toEqual([
		'/api/projects/one/sessions?cached=true',
		'/api/projects/one/sessions'
	]);

	refresh.resolve({ sessions: [{ sessionId: 'fresh', cwd: '/work', title: 'Fresh title' }] });
	await loading;
	expect(state.sessions).toEqual([{ sessionId: 'fresh', cwd: '/work', title: 'Fresh title' }]);
});

test('loads cron tasks as a distinct projectless Session collection', async () => {
	const requests: string[] = [];
	const state = new WorkspaceNavigation(null, {
		api: (async (path: string) => {
			requests.push(path);
			return { sessions: [{ sessionId: 'scheduled', cwd: '/work', title: 'Daily review' }] };
		}) as Api,
		guard: () => false,
		isMobile: () => false,
		endVoice() {},
		cacheSession() {},
		saveDraft() {},
		stopPolling() {},
		clearSession() {},
		setError() {},
		setLoading() {}
	} as never);

	await state.chooseSessionCollection('cron', 'none');

	expect(state.sessionCollection).toBe('cron');
	expect(state.sessions[0]?.title).toBe('Daily review');
	expect(requests).toEqual([
		'/api/sessions?scope=scheduled&cached=true',
		'/api/sessions?scope=scheduled'
	]);
});

test('publishes pages immediately and preserves the discovery cron projection through local continuation', async () => {
	const continuation = deferred<unknown>();
	const requests: string[] = [];
	const job = { profile: 'default', jobId: 'job' } as ExternalCronJob;
	const state = new WorkspaceNavigation(null, {
		api: (async (path: string) => {
			requests.push(path);
			const query = new URL(path, 'http://hue.local').searchParams;
			if (query.has('offset')) return continuation.promise;
			if (query.has('cached')) return { sessions: [], reconciliation: 'cached', projectId: null };
			return {
				sessions: [{ sessionId: 'first' }],
				hasMore: true,
				reconciliation: 'complete',
				projectId: null,
				externalCronJobs: [job],
				externalCronError: 'Profile unavailable'
			};
		}) as Api,
		setLoading() {},
		setError() {}
	} as never);
	state.sessionCollection = 'cron';
	const loading = state.loadActiveTab();
	for (let i = 0; i < 10; i++) await Promise.resolve();
	expect(state.sessions.map(({ sessionId }) => sessionId)).toEqual(['first']);
	expect(state.loadedSessionListProjectId).toBeUndefined();
	continuation.resolve({
		sessions: [{ sessionId: 'second' }],
		reconciliation: 'cached',
		projectId: null
	});
	await loading;
	expect(state.sessions.map(({ sessionId }) => sessionId)).toEqual(['first', 'second']);
	expect(state.externalCronJobs).toEqual([job]);
	expect(state.externalCronError).toBe('Profile unavailable');
	expect(state.loadedSessionListProjectId).toBe('cron');
	expect(requests.at(-1)).toContain('cached=true');
});

test('target lookup uses the cache without declaring the list complete or replacing other rows', async () => {
	const requests: string[] = [];
	const state = new WorkspaceNavigation(
		{ id: 'one', rootAvailable: true } as Project,
		{
			api: (async (path: string) => {
				requests.push(path);
				return { sessions: [{ sessionId: 'target' }], reconciliation: 'cached', projectId: 'one' };
			}) as Api,
			setLoading() {},
			setError() {}
		} as never
	);
	state.sessions = [{ sessionId: 'other', cwd: '/work' }];
	await state.loadActiveTab('target');
	expect(requests).toEqual(['/api/projects/one/sessions?sessionId=target&cached=true']);
	expect(state.sessions.map(({ sessionId }) => sessionId)).toEqual(['other', 'target']);
	expect(state.loadedSessionListProjectId).toBeUndefined();
});
