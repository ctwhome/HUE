import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

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
		runtime: {
			listSessions: async (root: string) =>
				root.endsWith('/.quick-ask')
					? [{ sessionId: 'kept-quick-ask', cwd: root, title: 'Quick Ask' }]
					: []
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
