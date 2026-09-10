import { expect, test } from 'bun:test';

if (!('$state' in globalThis)) Object.assign(globalThis, { $state: <T>(value?: T) => value });
const { SessionState } = await import('./session-state.svelte');

test('partial history preserves known harness-only messages and newer cursor state', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.transcript = [{ role: 'user', text: 'old harness history' }];
	state.timeline = [{ kind: 'message', sequence: -1, role: 'user', text: 'old harness history' }];
	state.eventCursor = 10;
	state.activeMessageId = 'new';
	state.delivery = 'running';
	state.applyLoaded({
		transcript: [],
		messages: [],
		events: [],
		cursor: 2,
		activeTurn: null,
		transcriptError: 'history unavailable'
	});
	expect(state.transcript[0]?.text).toBe('old harness history');
	expect(state.timeline[0]).toMatchObject({ text: 'old harness history' });
	expect(state.eventCursor).toBe(10);
	expect(state.activeMessageId).toBe('new');
});

test('view cache retains only the ten most recently visited sessions', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	for (let index = 0; index < 11; index++) {
		state.transcript = [{ role: 'user', text: String(index) }];
		state.cache({ sessionId: String(index), cwd: '/' });
	}
	state.showCached({ sessionId: '0', cwd: '/' });
	expect(state.transcript).toEqual([]);
	state.showCached({ sessionId: '10', cwd: '/' });
	expect(state.transcript[0]?.text).toBe('10');
});

test('a detail snapshot cannot overwrite a send begun after selection', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.showCached({ sessionId: 'a', cwd: '/' });
	state.activeMessageId = 'new-send';
	state.delivery = 'saving';
	state.applyLoaded({ transcript: [], messages: [], events: [], cursor: 0, activeTurn: null });
	expect(state.activeMessageId).toBe('new-send');
	expect(state.delivery).toBe('saving');
});

test('loaded failed turn retains its delivery label', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.applyLoaded({
		transcript: [],
		messages: [
			{
				id: 'failed',
				text: 'hello',
				images: [],
				attachments: [],
				reviewContexts: [],
				status: 'failed'
			}
		],
		events: [
			{
				sequence: 1,
				type: 'message.failed',
				payload: { messageId: 'failed', error: 'provider down' }
			}
		],
		cursor: 1,
		activeTurn: null
	});
	expect(state.delivery).toBe('failed');
});

test('load snapshot cannot replace a queued submission acknowledged during loading', () => {
	const state = new SessionState(
		() => null,
		() => {}
	);
	state.showCached({ sessionId: 'a', cwd: '/' });
	state.queuedMessages = [
		{
			id: 'new',
			text: 'followup',
			images: [],
			attachments: [],
			reviewContexts: [],
			status: 'queued'
		}
	];
	state.applyLoaded({ transcript: [], messages: [], events: [], cursor: 0, activeTurn: null });
	expect(state.queuedMessages[0]?.id).toBe('new');
});

test('clear resets every active Session field', () => {
	const state = new SessionState(
		() => null,
		() => undefined
	);
	Object.assign(state, {
		timeline: [{}],
		transcript: [{}],
		subagents: [{}],
		activity: [{}],
		plan: [{}],
		commands: [{}],
		runtime: { profile: 'custom' },
		branch: 'main',
		queuedMessages: [{}],
		eventCursor: 12,
		activeMessageId: 'message-1',
		pendingAssistant: 'answer',
		pendingImages: [{}],
		pendingThought: 'thinking',
		delivery: 'running'
	});

	state.clear();

	expect({
		timeline: state.timeline,
		transcript: state.transcript,
		subagents: state.subagents,
		activity: state.activity,
		plan: state.plan,
		commands: state.commands,
		runtime: state.runtime,
		branch: state.branch,
		queuedMessages: state.queuedMessages,
		eventCursor: state.eventCursor,
		activeMessageId: state.activeMessageId,
		pendingAssistant: state.pendingAssistant,
		pendingImages: state.pendingImages,
		pendingThought: state.pendingThought,
		delivery: state.delivery
	}).toEqual({
		timeline: [],
		transcript: [],
		subagents: [],
		activity: [],
		plan: [],
		commands: [],
		runtime: { profile: 'default' },
		branch: null,
		queuedMessages: [],
		eventCursor: 0,
		activeMessageId: '',
		pendingAssistant: '',
		pendingImages: [],
		pendingThought: '',
		delivery: ''
	});
});

test('response event previews do not skip an earlier terminal polling event', () => {
	const state = new SessionState(
		() => null,
		() => undefined
	);
	Object.assign(state, {
		eventCursor: 10,
		activeMessageId: 'message-1',
		delivery: 'running'
	});
	const workModeEvent = {
		sequence: 12,
		type: 'session.work_mode_changed',
		payload: { workMode: 'live' }
	};

	state.previewEvents([workModeEvent]);
	expect(state.eventCursor).toBe(10);

	state.applyEvents([
		{ sequence: 11, type: 'message.completed', payload: { messageId: 'message-1' } },
		workModeEvent
	]);

	expect(state.delivery).toBe('completed');
	expect(state.eventCursor).toBe(12);
	expect(state.timeline.filter((item) => item.kind === 'status')).toHaveLength(1);
});
