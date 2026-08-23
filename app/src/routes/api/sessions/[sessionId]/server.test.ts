import { expect, mock, test } from 'bun:test';

let workModeCalls: Array<{ sessionId: string; workMode: string; source: string }> = [];

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: {
			hasSession: () => true,
			getSession: () => ({
				sessionId: 'session-1',
				cwd: '/work/topic',
				icon: null,
				title: 'Topic',
				workMode: 'autonomous',
				pinned: false,
				archived: false,
				folder: null,
				tags: []
			}),
			getSessionSnapshot: () => ({
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: { status: 'running' }
			}),
			updateSessionWorkMode: (
				_projectId: null,
				sessionId: string,
				workMode: string,
				source: string
			) => {
				workModeCalls.push({ sessionId, workMode, source });
				return { session: { sessionId, workMode }, event: null };
			}
		},
		runtime: {
			loadTranscript: async () => [],
			getAvailableCommands: () => [],
			getSessionState: () => ({ profile: 'default' })
		},
		dispatcher: {
			withSessionLock: async (_id: string, operation: () => Promise<unknown>) => operation()
		}
	})
}));

test('PATCH updates projectless HUE work mode while a turn is running', async () => {
	workModeCalls = [];
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'PATCH',
			body: JSON.stringify({ workMode: 'live' })
		})
	} as never);

	expect(response.status).toBe(200);
	expect(workModeCalls).toEqual([{ sessionId: 'session-1', workMode: 'live', source: 'selector' }]);
	expect(await response.json()).toMatchObject({ workMode: 'live' });
});
