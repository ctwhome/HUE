import { expect, mock, test } from 'bun:test';

const snapshot = {
	messages: [{ id: 'msg-1', status: 'running' }],
	events: [],
	cursor: 3,
	activeTurn: { messageId: 'msg-1', status: 'running', output: 'Still working', error: null }
};
let associated = true;
const forked = { sessionId: 'forked-session', cwd: '/work/hue' };
let storedFork: typeof forked | null = null;

mock.module('$lib/server/services', () => ({
	projectBranch: () => null,
	services: () => ({
		store: {
			getProject: () => ({ id: 'project-1', rootPath: '/work/hue' }),
			hasProjectSession: () => associated,
			getSessionSnapshot: () => snapshot,
			upsertProjectSession: (_projectId: string, session: typeof forked) => (storedFork = session)
		},
		runtime: {
			loadTranscript: async () => {
				throw new Error('Hermes ACP reconnecting');
			},
			forkSession: async () => forked,
			getAvailableCommands: () => [],
			getSessionState: () => ({ profile: 'default' })
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

test('does not fork while the source session has an active turn', async () => {
	associated = true;
	storedFork = null;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' }
	} as never);

	expect(response.status).toBe(409);
	expect(storedFork).toBeNull();
});

test('forks an associated Hermes session and stores its project ownership', async () => {
	associated = true;
	snapshot.activeTurn = null as never;
	storedFork = null;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' }
	} as never);

	expect(response.status).toBe(201);
	expect(storedFork as unknown).toEqual(forked);
	expect(await response.json()).toEqual({
		session: forked,
		commands: [],
		runtime: { profile: 'default' }
	});
});
