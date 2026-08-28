import { expect, test } from 'bun:test';
import type { Project, Session, SessionLoad } from './types';

if (!('$state' in globalThis)) Object.assign(globalThis, { $state: <T>(value?: T) => value });
const { SessionState } = await import('./session-state.svelte');

test('preloaded Session views appear synchronously when selected', () => {
	let project = { id: 'one' } as Project | null;
	const state = new SessionState(() => project, () => undefined);
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
