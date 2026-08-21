import { expect, mock, test } from 'bun:test';

const snapshot = {
	messages: [{ id: 'msg-1', status: 'running' }],
	events: [],
	cursor: 3,
	activeTurn: { messageId: 'msg-1', status: 'running', output: 'Still working', error: null }
};
let associated = true;

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: {
			getProject: () => ({ id: 'project-1', rootPath: '/work/hue' }),
			hasProjectSession: () => associated,
			getSessionSnapshot: () => snapshot
		},
		runtime: {
			loadTranscript: async () => {
				throw new Error('Hermes ACP reconnecting');
			}
		}
	})
}));

test('returns stored turn state while Hermes transcript reconnects', async () => {
	associated = true;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'project-1', sessionId: 'session-1' }
	} as never);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		transcript: [],
		transcriptError: 'Hermes ACP reconnecting',
		...snapshot
	});
});

test('rejects a session not associated with the route project', async () => {
	associated = false;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'project-1', sessionId: 'other-session' }
	} as never);

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: 'Session not found' });
});
