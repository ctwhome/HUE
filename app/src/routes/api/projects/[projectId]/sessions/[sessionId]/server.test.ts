import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const snapshot = {
	messages: [{ id: 'msg-1', status: 'running' }],
	events: [],
	cursor: 3,
	activeTurn: { messageId: 'msg-1', status: 'running', output: 'Still working', error: null }
};
let associated = true;
const forked = { sessionId: 'forked-session', cwd: '/work/hue' };
let storedFork: typeof forked | null = null;
let transcriptCwd = '';
let runtimeTranscriptCalls = 0;
let sourceTitle = 'Source';
let forkCalls = 0;
let canFork = true;
let failCopy = false;
let lockActive = false;
let metadataMutated = false;
let listCalls = 0;
let workModeCalls: Array<{
	projectId: string;
	sessionId: string;
	workMode: string;
	source: string;
}> = [];

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({
		id: 'project-1',
		name: 'HUE',
		icon: null,
		primary_path: '/work/hue-new',
		folders: [{ path: '/work/hue-new', label: null, is_primary: true, added_at: 1 }],
		archived: false
	}),
	sessionMatchesProjectFolders: () => true,
	projectBranch: () => null,
	sessionMatchesProjectRoot: () => true,
	services: () => ({
		store: {
			getProject: () => ({ id: 'project-1', rootPath: '/work/hue-new' }),
			hasSession: () => associated,
			getSession: () => ({
				sessionId: 'session-1',
				cwd: '/work/hue-old',
				icon: null,
				title: sourceTitle,
				workMode: 'autonomous',
				pinned: false,
				archived: false,
				folder: null,
				tags: []
			}),
			getSessionSnapshot: () => snapshot,
			upsertSession: (_projectId: string, session: typeof forked) => (storedFork = session),
			prepareSessionCopy: (_projectId: string, _sessionId: string, title?: unknown) => {
				const value = title === undefined ? `${sourceTitle} copy` : title;
				if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
					throw new Error('Session title must be 1-200 characters');
				}
				return { title: value.trim(), pinned: false, archived: false, folder: null, tags: [] };
			},
			copySessionMetadata: () => {
				if (failCopy) throw new Error('SQLite disk full');
				return forked;
			},
			updateSessionWorkMode: (
				projectId: string,
				sessionId: string,
				workMode: string,
				source: string
			) => {
				workModeCalls.push({ projectId, sessionId, workMode, source });
				return { session: { ...forked, workMode }, event: null };
			},
			updateSessionMetadata: () => {
				metadataMutated = true;
				return { title: 'After', icon: null };
			},
			updateSession: () => {
				metadataMutated = true;
				return { title: 'After', icon: null };
			},
			getBusySessionStarts: () => ({}),
			getSessionIndicators: () => ({})
		},
		admin: {
			loadTranscript: async () => {
				throw new Error('Hermes transcript read unavailable');
			}
		},
		runtime: {
			loadTranscript: async (cwd: string) => {
				transcriptCwd = cwd;
				runtimeTranscriptCalls += 1;
				return [];
			},
			forkSession: async () => {
				forkCalls += 1;
				if (!lockActive) throw new Error('fork escaped Session delivery lock');
				if (!canFork) throw new Error('Hermes does not support Session duplication');
				return forked;
			},
			listSessions: async () => {
				listCalls += 1;
				return [];
			},
			getAvailableCommands: () => [],
			getSessionState: () => ({ profile: 'default' })
		},
		dispatcher: {
			withSessionLock: async (_sessionId: string, operation: () => Promise<unknown>) => {
				lockActive = true;
				try {
					return await operation();
				} finally {
					lockActive = false;
				}
			}
		}
	})
}));

test('returns stored turn state when the lightweight Hermes transcript read is unavailable', async () => {
	associated = true;
	transcriptCwd = '';
	runtimeTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'project-1', sessionId: 'session-1' }
	} as never);

	expect(response.status).toBe(200);
	expect(transcriptCwd).toBe('');
	expect(runtimeTranscriptCalls).toBe(0);
	expect(await response.json()).toEqual({
		transcript: [],
		transcriptError: 'Hermes transcript read unavailable',
		workMode: 'autonomous',
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

test('returns an actionable conflict after core negotiation finds fork unsupported', async () => {
	associated = true;
	snapshot.activeTurn = null as never;
	forkCalls = 0;
	canFork = false;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', { method: 'POST', body: '{}' })
	} as never);

	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({ error: 'Hermes does not support Session duplication' });
	expect(forkCalls).toBe(1);
	canFork = true;
});

test('rejects explicit and derived overlong duplicate titles before Hermes fork', async () => {
	associated = true;
	snapshot.activeTurn = null as never;
	forkCalls = 0;
	const { POST } = await import('./+server');
	const explicit = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ title: 'x'.repeat(201) })
		})
	} as never);
	expect(explicit.status).toBe(400);

	sourceTitle = 'x'.repeat(200);
	const derived = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', { method: 'POST', body: '{}' })
	} as never);
	expect(derived.status).toBe(400);
	expect(forkCalls).toBe(0);
	sourceTitle = 'Source';
});

test('rejects an invalid duplicate title type before Hermes fork', async () => {
	associated = true;
	snapshot.activeTurn = null as never;
	forkCalls = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ title: 42 })
		})
	} as never);

	expect(response.status).toBe(400);
	expect(forkCalls).toBe(0);
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

test('returns the retained Hermes fork visibly when metadata persistence needs reconciliation', async () => {
	associated = true;
	snapshot.activeTurn = null as never;
	storedFork = null;
	failCopy = true;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', { method: 'POST', body: '{}' })
	} as never);
	failCopy = false;

	expect(response.status).toBe(202);
	expect(storedFork as unknown).toEqual(forked);
	expect(await response.json()).toEqual({
		session: forked,
		reconciliationRequired: true,
		error: 'SQLite disk full'
	});
});

test('does not mutate valid metadata when a combined icon is invalid', async () => {
	associated = true;
	metadataMutated = false;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'PATCH',
			body: JSON.stringify({
				title: 'After',
				pinned: true,
				icon: 'data:text/html;base64,PHNjcmlwdD4='
			})
		})
	} as never);

	expect(response.status).toBe(400);
	expect(metadataMutated).toBe(false);
});

test('looks up a deep-linked Session directly without listing Hermes Sessions', async () => {
	associated = true;
	listCalls = 0;
	const { GET } = await import('../+server');
	const response = await GET({
		params: { projectId: 'project-1' },
		url: new URL('http://hue.test/api/projects/project-1/sessions?sessionId=session-1')
	} as never);

	expect(response.status).toBe(200);
	expect((await response.json()).sessions).toEqual([
		expect.objectContaining({ sessionId: 'session-1', title: 'Source' })
	]);
	expect(listCalls).toBe(0);
});

test('PATCH updates HUE work mode even while turn is running', async () => {
	workModeCalls = [];
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-1', sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'PATCH',
			body: JSON.stringify({ workMode: 'live' })
		})
	} as never);

	expect(response.status).toBe(200);
	expect(workModeCalls).toEqual([
		{ projectId: 'project-1', sessionId: 'session-1', workMode: 'live', source: 'selector' }
	]);
});
