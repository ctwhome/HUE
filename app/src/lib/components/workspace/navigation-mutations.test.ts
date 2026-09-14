import { expect, mock, test } from 'bun:test';
import type { Api, Project, Session } from './types';

Object.assign(globalThis, { $state: <T>(value: T) => value });
mock.module('$app/navigation', () => ({ pushState() {}, replaceState() {} }));
mock.module('$app/state', () => ({ page: { state: {} } }));
const { WorkspaceNavigation } = await import('./navigation.svelte');

function deferred<T>() {
	let resolve!: (value: T) => void;
	return { promise: new Promise<T>((done) => (resolve = done)), resolve: (value: T) => resolve(value) };
}
const project = (id: string) => ({ id, rootAvailable: true, sessionCount: 2 } as Project);
const session = (id: string) => ({ sessionId: id, cwd: '/tmp', title: id } as Session);

function navigation(api: Api) {
	const sent: string[] = [];
	const state = new WorkspaceNavigation(project('A'), {
		api, guard: () => false, getRuntimeProfile: () => 'default',
		endVoice() {}, cacheSession() {}, saveDraft() {}, stopPolling() {}, clearSession() {},
		clearSessionState() {}, restoreDraft() {}, setError() {}, setLoading() {},
		focusComposer() {}, applyCreatedSession() {},
		sendText: async (text: string) => { sent.push(text); return true; }
	} as never);
	state.persistSelection = () => {};
	return { state, sent };
}
const workflow = { id: 'workflow', name: 'Workflow', profile: 'default', bundle: 'autonomous', prompt: 'Do work in A' };

test('Workflow validation cannot redirect execution to a newly selected Project', async () => {
	const validation = deferred<{ bundles: Array<{ slug: string }> }>();
	const calls: string[] = [];
	const { state, sent } = navigation((async (path) => { calls.push(path); return validation.promise; }) as Api);
	const running = state.runWorkflow(workflow as never);
	state.selectedProject = project('B');
	validation.resolve({ bundles: [{ slug: 'autonomous' }] });
	await running;
	expect(calls).toEqual(['/api/hermes/bundles']);
	expect(sent).toEqual([]);
});

test('Workflow creation cannot send into a different selected Session', async () => {
	const creation = deferred<{ session: Session }>();
	const { state, sent } = navigation((async (path) => path === '/api/hermes/bundles'
		? { bundles: [{ slug: 'autonomous' }] } : creation.promise) as Api);
	const running = state.runWorkflow(workflow as never);
	for (let i = 0; i < 10; i++) await Promise.resolve();
	state.selectedSession = session('other');
	creation.resolve({ session: session('created') });
	await running;
	expect(state.selectedSession?.sessionId).toBe('other');
	expect(sent).toEqual([]);
});

test('Workflow still sends when its created Session remains selected', async () => {
	const { state, sent } = navigation((async (path) => path === '/api/hermes/bundles'
		? { bundles: [{ slug: 'autonomous' }] } : { session: session('created') }) as Api);
	await state.runWorkflow(workflow as never);
	expect(sent).toEqual(['/autonomous Do work in A']);
});

test('a stale deletion preview never confirms or deletes a different Session', async () => {
	const preview = deferred<unknown>();
	const calls: string[] = [];
	const { state } = navigation((async (path) => { calls.push(path); return preview.promise; }) as Api);
	const a = session('one');
	state.editingSession = a;
	const deleting = state.deleteSession();
	state.editingSession = session('two');
	preview.resolve({ impact: { messages: 100, events: 200, attachments: 3, activeDeliveries: 0 } });
	await deleting;
	expect(calls).toEqual(['/api/projects/A/sessions/one']);
	expect(state.editingSession.sessionId).toBe('two');
});

test('a confirmed deletion finishes in its original Project after navigation', async () => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => true } });
	const completion = deferred<unknown>();
	const calls: string[] = [];
	const { state } = navigation((async (path) => {
		calls.push(path);
		return path.includes('confirm=true') ? completion.promise
			: { impact: { messages: 1, events: 1, attachments: 0, activeDeliveries: 0 } };
	}) as Api);
	const origin = state.selectedProject!;
	state.editingSession = session('one');
	try {
		const deleting = state.deleteSession();
		for (let i = 0; i < 10; i++) await Promise.resolve();
		state.selectedProject = project('B');
		state.sessions = [session('two')];
		completion.resolve({ deleted: true });
		await deleting;
		expect(calls).toEqual(['/api/projects/A/sessions/one', '/api/projects/A/sessions/one?confirm=true']);
		expect(origin.sessionCount).toBe(1);
		expect(state.selectedProject.sessionCount).toBe(2);
		expect(state.sessions.map(({ sessionId }) => sessionId)).toEqual(['two']);
		expect(state.removedSession).toEqual({ projectId: 'A', sessionId: 'one' });
	} finally {
		if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
