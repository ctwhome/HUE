import { expect, test } from 'bun:test';
import type { SessionLoad } from './types';

Reflect.set(globalThis, '$state', <T>(value: T) => value);
const { SessionState } = await import('./session-state.svelte');
const { createSessionHistoryController } = await import('./session-controller.svelte');

const history = (complete: boolean) =>
	({
		mode: complete ? 'full' : 'recent',
		complete,
		fullUrl: '/api/sessions/a?history=full'
	}) as const;
const load = (patch: Partial<SessionLoad> = {}): SessionLoad => ({
	transcript: [],
	messages: [],
	events: [],
	cursor: 0,
	activeTurn: null,
	...patch
});
const message = (id: string, text: string) => ({
	id,
	text,
	images: [],
	attachments: [],
	reviewContexts: [],
	status: 'running'
});

test('nonempty recent history retains a complete cached prefix and applies new replay events', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.applyLoaded(
		load({
			history: history(true),
			transcript: [
				{ role: 'user', text: 'oldest' },
				{ role: 'assistant', text: 'old answer' }
			],
			cursor: 2
		})
	);
	state.cache({ sessionId: 'a', cwd: '/' });
	state.clear();
	state.showCached({ sessionId: 'a', cwd: '/' });
	state.applyLoaded(
		load({
			history: history(false),
			transcript: [{ role: 'user', text: 'recent' }],
			messages: [message('new', 'recent')],
			events: [
				{ sequence: 3, type: 'message.accepted', payload: { messageId: 'new' } },
				{ sequence: 4, type: 'agent.chunk', payload: { messageId: 'new', text: 'new answer' } }
			],
			cursor: 4
		})
	);
	expect(state.timeline.filter((item) => item.kind === 'message').map((item) => item.text)).toEqual(
		['oldest', 'old answer', 'recent', 'new answer']
	);
	expect(state.transcript.map((item) => item.text)).toEqual([
		'oldest',
		'old answer',
		'recent',
		'new answer'
	]);
	expect(state.history?.complete).toBe(true);
	expect(state.eventCursor).toBe(4);
});

test('full history racing newer chunks prepends older history without reverting the live turn', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	const events = [
		{ sequence: 1, type: 'message.accepted', payload: { messageId: 'turn' } },
		{ sequence: 2, type: 'agent.chunk', payload: { messageId: 'turn', text: 'part' } }
	];
	state.applyLoaded(
		load({
			history: history(false),
			messages: [message('turn', 'question')],
			events,
			cursor: 2,
			activeTurn: { messageId: 'turn', status: 'running', output: 'part', thought: '', error: null }
		})
	);
	const origin = state.captureLoad();
	state.applyEvents([
		{ sequence: 3, type: 'agent.chunk', payload: { messageId: 'turn', text: ' newer' } }
	]);
	state.applyLoaded(
		load({
			history: history(true),
			transcript: [
				{ role: 'user', text: 'oldest' },
				{ role: 'assistant', text: 'old answer' }
			],
			messages: [message('turn', 'question')],
			events,
			cursor: 2
		}),
		origin
	);
	expect(state.timeline.filter((item) => item.kind === 'message').map((item) => item.text)).toEqual(
		['oldest', 'old answer', 'question', 'part newer']
	);
	expect(state.pendingAssistant).toBe('part newer');
	expect(state.delivery).toBe('running');
	expect(state.eventCursor).toBe(3);
	expect(state.history?.complete).toBe(true);
	state.applyEvents([{ sequence: 4, type: 'message.completed', payload: { messageId: 'turn' } }]);
	expect(state.transcript.filter((item) => item.text === 'part newer')).toHaveLength(1);
});

test('recent snapshot still replays new events when local runtime changed after loading began', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.showCached({ sessionId: 'a', cwd: '/' });
	state.runtime = { profile: 'new-model' };
	state.applyLoaded(
		load({
			history: history(false),
			messages: [message('new', 'question')],
			events: [{ sequence: 1, type: 'message.accepted', payload: { messageId: 'new' } }],
			cursor: 1,
			runtime: { profile: 'stale' },
			activeTurn: { messageId: 'new', status: 'running', output: '', thought: '', error: null }
		})
	);
	expect(state.timeline).toEqual([expect.objectContaining({ text: 'question' })]);
	expect(state.runtime.profile).toBe('new-model');
	expect(state.eventCursor).toBe(1);
	expect(state.delivery).toBe('running');
	expect(state.activeMessageId).toBe('new');
});

function controllerHarness() {
	let generation = 1;
	const requests: Array<{
		path: string;
		signal?: AbortSignal | null;
		resolve: (body: SessionLoad) => void;
		reject: (error: Error) => void;
	}> = [];
	const sessionState = new SessionState(
		() => null,
		() => {}
	);
	const navigation = {
		captureSessionSelection: () => ({ generation, projectId: null, sessionId: String(generation) }),
		isCurrentSessionSelection: (selection: { generation: number }) =>
			selection.generation === generation,
		sessionApiPath: (id: string, suffix = '') => `/api/sessions/${id}${suffix}`
	};
	const controller = createSessionHistoryController({
		api: (path: string, init: RequestInit) =>
			new Promise((resolve, reject) =>
				requests.push({ path, signal: init.signal, resolve, reject })
			),
		getSession: () => ({ sessionId: String(generation), harness: 'opencode', cwd: '/' }),
		getNavigation: () => navigation,
		sessionState,
		startPolling() {}
	} as never);
	return {
		controller,
		sessionState,
		requests,
		switchSelection() {
			generation++;
			sessionState.clear();
		}
	};
}

test('older history action requests full history and exposes selection-scoped feedback', async () => {
	const h = controllerHarness();
	h.sessionState.history = history(false);
	const pending = h.controller.loadFullHistory();
	expect(h.requests[0].path).toBe('/api/sessions/1?history=full');
	expect(h.controller.historyLoading).toBe(true);
	h.requests[0].resolve(
		load({ history: history(true), transcript: [{ role: 'user', text: 'oldest' }] })
	);
	expect(await pending).toBe(true);
	expect(h.sessionState.timeline[0]).toMatchObject({ text: 'oldest' });
	expect(h.controller.historyLoading).toBe(false);
	expect(h.controller.historyError).toBe('');
});

test('switching selection abandons full history without blocking the destination', async () => {
	const h = controllerHarness();
	const first = h.controller.loadFullHistory();
	h.switchSelection();
	expect(h.controller.historyLoading).toBe(false);
	await h.controller.hydrateEmptyHistory();
	expect(h.requests[0].signal?.aborted).toBe(true);
	const second = h.controller.loadFullHistory();
	expect(h.requests[0].signal?.aborted).toBe(true);
	h.requests[0].resolve(
		load({ history: history(true), transcript: [{ role: 'user', text: 'stale' }] })
	);
	expect(await first).toBe(false);
	expect(h.controller.historyLoading).toBe(true);
	h.requests[1].reject(new Error('history unavailable'));
	expect(await second).toBe(false);
	expect(h.sessionState.timeline).toEqual([]);
	expect(h.controller.historyError).toBe('history unavailable');
});

test('late creation metadata does not reset a turn or overwrite a newer runtime selection', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	const origin = state.captureLoad();
	state.activeMessageId = 'new-send';
	state.delivery = 'saving';
	state.eventCursor = 3;
	state.runtime = { profile: 'new-model' };
	state.timeline = [
		{ kind: 'message', role: 'user', text: 'new draft', messageId: 'new-send', sequence: 3 }
	];
	state.applyCreated({ runtime: { profile: 'old-model' } }, origin);
	expect(state.activeMessageId).toBe('new-send');
	expect(state.eventCursor).toBe(3);
	expect(state.timeline[0]).toMatchObject({ text: 'new draft' });
	expect(state.runtime.profile).toBe('new-model');
});

test('empty idle OpenCode hydrates once and an incomplete response cannot cause a request loop', async () => {
	const h = controllerHarness();
	h.sessionState.history = history(false);
	h.sessionState.delivery = 'running';
	expect(await h.controller.hydrateEmptyHistory()).toBe(false);
	expect(h.requests).toHaveLength(0);
	h.sessionState.delivery = '';
	const pending = h.controller.hydrateEmptyHistory();
	expect(h.controller.historyLoading).toBe(true);
	h.requests[0].resolve(load({ history: { ...history(false), mode: 'full' } }));
	expect(await pending).toBe(false);
	expect(h.controller.historyError).not.toBe('');
	expect(await h.controller.hydrateEmptyHistory()).toBe(false);
	expect(h.requests).toHaveLength(1);
});

test('an active incomplete OpenCode full response waits for idle before trying once again', async () => {
	const h = controllerHarness();
	h.sessionState.history = history(false);
	const first = h.controller.hydrateEmptyHistory();
	h.requests[0].resolve(
		load({
			history: { ...history(false), mode: 'full' },
			activeTurn: { messageId: 'active', status: 'running', output: '', thought: '', error: null }
		})
	);
	await first;
	await h.controller.hydrateEmptyHistory();
	await h.controller.hydrateEmptyHistory();
	expect(h.requests).toHaveLength(1);
	h.sessionState.delivery = 'completed';
	const second = h.controller.hydrateEmptyHistory();
	h.requests[1].resolve(
		load({ history: history(true), transcript: [{ role: 'user', text: 'oldest' }] })
	);
	expect(await second).toBe(true);
	await h.controller.hydrateEmptyHistory();
	expect(h.requests).toHaveLength(2);
});

test('unknown delivery and visible local messages never trigger automatic full replay', async () => {
	const h = controllerHarness();
	h.sessionState.history = history(false);
	h.sessionState.delivery = 'delivery unknown';
	await h.controller.hydrateEmptyHistory();
	h.sessionState.delivery = '';
	h.sessionState.timeline = [{ kind: 'message', role: 'user', text: 'visible', sequence: 1 }];
	await h.controller.hydrateEmptyHistory();
	expect(h.requests).toHaveLength(0);
});

test('full history may finish after a new local send without clearing its delivery or draft', async () => {
	const h = controllerHarness();
	const pending = h.controller.loadFullHistory();
	h.sessionState.activeMessageId = 'new-send';
	h.sessionState.delivery = 'saving';
	h.sessionState.timeline = [
		{
			kind: 'message',
			role: 'user',
			text: 'new draft',
			messageId: 'new-send',
			sequence: Number.MAX_SAFE_INTEGER
		}
	];
	h.requests[0].resolve(
		load({ history: history(true), transcript: [{ role: 'user', text: 'oldest' }] })
	);
	await pending;
	expect(
		h.sessionState.timeline.filter((item) => item.kind === 'message').map((item) => item.text)
	).toEqual(['oldest', 'new draft']);
	expect(h.sessionState.delivery).toBe('saving');
	expect(h.sessionState.activeMessageId).toBe('new-send');
});
