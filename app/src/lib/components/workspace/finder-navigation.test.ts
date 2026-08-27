import { expect, mock, test } from 'bun:test';
import type { Api, Project } from './types';

Object.assign(globalThis, { $state: <T>(value?: T) => value });
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
	expect(requests).toEqual(['/api/projects/one/sessions', '/api/projects/two/sessions']);
});
