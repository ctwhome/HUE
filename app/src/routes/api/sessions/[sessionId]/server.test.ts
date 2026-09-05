import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let workModeCalls: Array<{ sessionId: string; workMode: string; source: string }> = [];
let lightweightTranscriptCalls = 0;
let runtimeTranscriptCalls = 0;
let sessionHarness: 'hermes' | 'opencode' = 'hermes';
let activeTurn: { status: string } | null = { status: 'running' };
let lockCalls = 0;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	services: () => ({
		store: {
			hasSession: () => true,
			getSession: () => ({
				sessionId: 'session-1',
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
			getSessionSnapshot: () => ({
				messages: [],
				events: [],
				cursor: 0,
				activeTurn
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

test('GET reads one projectless transcript without loading the ACP Session', async () => {
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
	expect((await response.json()).transcript).toEqual([
		{ role: 'assistant', text: 'Loaded without ACP' }
	]);
	expect(lightweightTranscriptCalls).toBe(1);
	expect(runtimeTranscriptCalls).toBe(0);
});

test('GET does not replay an OpenCode transcript into an active turn', async () => {
	sessionHarness = 'opencode';
	activeTurn = { status: 'running' };
	lightweightTranscriptCalls = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/api/sessions/session-1')
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
		url: new URL('http://hue.test/api/sessions/session-1')
	} as never);

	expect(response.status).toBe(200);
	expect(lockCalls).toBe(1);
	expect(lightweightTranscriptCalls).toBe(1);
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
