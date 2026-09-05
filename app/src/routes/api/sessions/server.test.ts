import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const createdHarnesses: string[] = [];

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	unprojectedSessionRoot: () => '/Users/ctw/.hue/sessions',
	quickAskSessionRoot: () => '/Users/ctw/.hue/sessions/.quick-ask',
	sessionMatchesProjectRoot: (root: string, cwd: string) => root === cwd,
	services: () => ({
		store: {
			isKeptQuickAskSession: (sessionId: string) => sessionId === 'kept-quick-ask',
			isSessionDismissed: () => false,
			upsertSession: () => undefined,
			getSession: (_projectId: null, sessionId: string) => ({
				sessionId,
				externalSessionId: 'native-session',
				harness: createdHarnesses.at(-1) ?? 'hermes',
				cwd: '/Users/ctw/.hue/sessions',
				icon: null,
				title: null,
				workMode: 'autonomous'
			}),
			getBusySessionStarts: () => ({}),
			getSessionIndicators: () => ({}),
			listSessionPage: () => ({
				sessions: [
					{
						sessionId: 'active-session',
						cwd: '/Users/ctw/.hue/sessions',
						title: 'Active Session',
						icon: null
					},
					{
						sessionId: 'kept-quick-ask',
						cwd: '/Users/ctw/.hue/sessions/.quick-ask',
						title: 'Quick Ask',
						icon: null
					}
				],
				hasMore: false
			})
		},
		sessionRuntime: {
			listSessions: async (root: string, harness = 'hermes') =>
				harness === 'opencode'
					? []
					: root.endsWith('/.quick-ask')
					? [{ sessionId: 'kept-quick-ask', cwd: root, title: 'Quick Ask' }]
					: [],
			createSession: async (root: string, harness: string) => {
				createdHarnesses.push(harness);
				return {
					sessionId: 'opencode:native-session',
					externalSessionId: 'native-session',
					harness,
					cwd: root,
					title: null
				};
			},
			getAvailableCommands: () => [],
			getSessionState: () => ({ harness: 'opencode' })
		},
		dispatcher: { recover: () => undefined }
	})
}));

test('keeps a stored Session available when Hermes temporarily omits it', async () => {
	const { GET } = await import('./+server');
	const response = await GET({
		url: new URL('http://localhost/api/sessions?scope=unscheduled')
	} as never);

	expect(response.status).toBe(200);
	expect((await response.json()).sessions).toEqual([
		expect.objectContaining({
			sessionId: 'active-session',
			available: true,
			recovery: null
		}),
		expect.objectContaining({
			sessionId: 'kept-quick-ask',
			available: true,
			recovery: null
		})
	]);
});

test('creates a projectless OpenCode Session when selected', async () => {
	createdHarnesses.length = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		request: new Request('http://localhost/api/sessions', {
			method: 'POST',
			body: JSON.stringify({ harness: 'opencode' })
		})
	} as never);

	expect(response.status).toBe(201);
	expect(createdHarnesses).toEqual(['opencode']);
	expect((await response.json()).session).toMatchObject({ harness: 'opencode' });
});
