import { expect, test } from 'bun:test';
import type { Api, Session, SessionEvent } from './types';

Object.assign(globalThis, { $state: <T>(value?: T) => value });
const { WorkspaceNavigation } = await import('./navigation.svelte');

function navigation(api: Api = (async () => ({})) as Api) {
	return new WorkspaceNavigation(null, { api } as never);
}

const infoEvent = (title: string): SessionEvent => ({
	sequence: 1,
	type: 'session.info_updated',
	payload: { title }
});

test('session info events update titles and derive icons without replacing custom icons', () => {
	const automatic = { sessionId: 'auto', cwd: '/work', title: null, customIcon: null } as Session;
	const custom = {
		sessionId: 'custom',
		cwd: '/work',
		title: null,
		icon: '⭐',
		customIcon: '⭐'
	} as Session;
	const state = navigation();
	state.sessions = [automatic, custom];
	state.selectedSession = automatic;

	state.applySessionInfoEvents([infoEvent('Debug message delivery')]);

	expect(state.sessions[0]).toMatchObject({ title: 'Debug message delivery', icon: '🐛' });
	expect(state.selectedSession).toMatchObject({ title: 'Debug message delivery', icon: '🐛' });
	state.selectedSession = custom;
	state.applySessionInfoEvents([infoEvent('Implement title updates')]);
	expect(state.sessions[1]).toMatchObject({ title: 'Implement title updates', icon: '⭐' });
});

test('saving a session icon does not claim title authority', async () => {
	let request: RequestInit | undefined;
	const state = navigation((async (_path, options) => {
		request = options;
		return { session: { sessionId: 'session-1', cwd: '/work', title: 'Generated' }, icon: '⭐' };
	}) as Api);
	state.editingSession = { sessionId: 'session-1', cwd: '/work', title: 'Generated' };
	state.sessionIcon = '⭐';

	await state.saveSessionIcon();

	expect(JSON.parse(String(request?.body))).toEqual({ icon: '⭐' });
});

test('saving other session metadata only includes a title when it changed', async () => {
	let request: RequestInit | undefined;
	const state = navigation((async (_path, options) => {
		request = options;
		return { session: { sessionId: 'session-1', cwd: '/work', title: 'Generated' }, icon: null };
	}) as Api);
	state.editingSession = { sessionId: 'session-1', cwd: '/work', title: 'Generated' };
	state.sessionTitle = 'Generated';
	state.sessionPinned = true;

	await state.saveSession();

	expect(JSON.parse(String(request?.body))).not.toContainKey('title');
});
