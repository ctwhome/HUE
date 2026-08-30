import { expect, test } from 'bun:test';
import type { Project, Session, SessionLoad } from './types';

if (!('$state' in globalThis)) Object.assign(globalThis, { $state: <T>(value?: T) => value });
const { SessionState } = await import('./session-state.svelte');

test('preloaded Session views appear synchronously when selected', () => {
	let project = { id: 'one' } as Project | null;
	const state = new SessionState(
		() => project,
		() => undefined
	);
	const body = {
		transcript: [{ role: 'assistant', text: 'Ready from cache' }],
		messages: [],
		events: [],
		cursor: 42,
		activeTurn: null,
		commands: [],
		runtime: { profile: 'default' }
	} as SessionLoad;

	state.preload('one', 'session-1', body);
	state.showCached({ sessionId: 'session-1', cwd: '/work' } as Session);

	expect(state.transcript).toEqual([{ role: 'assistant', text: 'Ready from cache' }]);
	expect(state.timeline).toEqual([
		expect.objectContaining({ role: 'assistant', text: 'Ready from cache' })
	]);
	expect(state.eventCursor).toBe(42);

	project = { id: 'two' } as Project;
	state.showCached({ sessionId: 'session-1', cwd: '/work' } as Session);
	expect(state.transcript).toEqual([]);
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
