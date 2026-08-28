import { expect, mock, test } from 'bun:test';
import type { Api, Project } from './types';

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
			if (path === '/api/projects/one/sessions') return firstLoad.promise;
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
		'/api/projects/one/sessions?cached=true',
		'/api/projects/two/sessions?cached=true',
		'/api/projects/one/sessions',
		'/api/projects/two/sessions'
	]);
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
	const refresh = deferred<{ sessions: Array<{ sessionId: string; cwd: string; title: string }> }>();
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
		isMobile: () => false,
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
	expect(requests).toEqual([
		'/api/projects/one/sessions?cached=true',
		'/api/projects/one/sessions'
	]);

	refresh.resolve({ sessions: [{ sessionId: 'fresh', cwd: '/work', title: 'Fresh title' }] });
	await loading;
	expect(state.sessions).toEqual([{ sessionId: 'fresh', cwd: '/work', title: 'Fresh title' }]);
});
