import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let workModeCalls: Array<{ sessionId: string; workMode: string; source: string }> = [];
let lightweightTranscriptCalls = 0;
let runtimeTranscriptCalls = 0;
let sessionHarness: 'hermes' | 'opencode' = 'hermes';
let activeTurn: { status: string } | null = { status: 'running' };
let lockCalls = 0;
let snapshotLimit: number | undefined;
let transcriptLimit: number | undefined;
let transcriptFailure = false;
let transcriptComplete = false;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	services: () => ({
		store: {
			hasSession: () => true,
			getSession: () => ({
				sessionId: 'session-1',
				externalSessionId: 'native-1',
				cwd: '/work/topic',
				icon: null,
				title: 'Topic',
				workMode: 'autonomous',
				harness: sessionHarness,
				pinned: false,
				archived: false,
				folder: null,
				tags: []
			}),
			getSessionSnapshot: (_projectId: null, _sessionId: string, limit?: number) => (
				(snapshotLimit = limit),
				{
					messages: [],
					events: [],
					cursor: 0,
					activeTurn
				}
			),
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
		admin: {
			loadTranscriptWithCoverage: async (_id: string, _profile?: string, limit?: number) => {
				if (transcriptFailure) throw new Error('History unavailable');
				transcriptLimit = limit;
				lightweightTranscriptCalls += 1;
				return {
					transcript: [{ role: 'assistant', text: 'Loaded without ACP' }],
					complete: transcriptComplete
				};
			}
		},
		sessionRuntime: {
			loadTranscript: async () => {
				lightweightTranscriptCalls += 1;
				return [{ role: 'assistant', text: 'Loaded without ACP' }];
			},
			getAvailableCommands: () => [],
			getSessionState: () => ({ profile: 'default' })
		},
		dispatcher: {
			withSessionLock: async (_id: string, operation: () => Promise<unknown>) => {
				lockCalls += 1;
				return operation();
			}
		}
	})
}));

test('GET reads a recent projectless window with an explicit full-history URL', async () => {
	sessionHarness = 'hermes';
	activeTurn = { status: 'running' };
	lightweightTranscriptCalls = 0;
	runtimeTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/api/sessions/session-1')
	} as never);

	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body.transcript).toEqual([{ role: 'assistant', text: 'Loaded without ACP' }]);
	expect(lightweightTranscriptCalls).toBe(1);
	expect(runtimeTranscriptCalls).toBe(0);
	expect(snapshotLimit).toBe(50);
	expect(transcriptLimit).toBe(100);
	expect(body.history).toEqual({
		mode: 'recent',
		complete: false,
		fullUrl: '/api/sessions/session-1?history=full'
	});
});

test('marks a small recent Hermes history complete when both sources fit', async () => {
	sessionHarness = 'hermes';
	transcriptComplete = true;
	try {
		const { GET } = await import('./+server');
		const response = await GET({
			params: { sessionId: 'session-1' },
			url: new URL('http://hue.test/api/sessions/session-1')
		} as never);
		expect(await response.json()).toMatchObject({ history: { mode: 'recent', complete: true } });
	} finally {
		transcriptComplete = false;
	}
});

test('GET does not replay an OpenCode transcript into an active turn', async () => {
	sessionHarness = 'opencode';
	activeTurn = { status: 'running' };
	lightweightTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/api/sessions/session-1?history=full')
	} as never);

	expect(response.status).toBe(200);
	expect((await response.json()).transcript).toEqual([]);
	expect(lightweightTranscriptCalls).toBe(0);
});

test('GET serializes an inactive OpenCode transcript replay with message delivery', async () => {
	sessionHarness = 'opencode';
	activeTurn = null;
	lockCalls = 0;
	lightweightTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/api/sessions/session-1?history=full')
	} as never);

	expect(response.status).toBe(200);
	expect(lockCalls).toBe(1);
	expect(lightweightTranscriptCalls).toBe(1);
});

test('recent OpenCode detail defers replay even when idle', async () => {
	sessionHarness = 'opencode';
	activeTurn = null;
	lightweightTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/api/sessions/session-1')
	} as never);
	expect(await response.json()).toMatchObject({
		transcript: [],
		history: { mode: 'recent', complete: false }
	});
	expect(lightweightTranscriptCalls).toBe(0);
});

test('returns explicit partial history on outage even without local messages', async () => {
	sessionHarness = 'hermes';
	transcriptFailure = true;
	try {
		const { GET } = await import('./+server');
		const response = await GET({
			params: { sessionId: 'session-1' },
			url: new URL('http://hue.test/api/sessions/session-1')
		} as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			transcriptError: 'History unavailable',
			history: { complete: false }
		});
	} finally {
		transcriptFailure = false;
	}
});

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
