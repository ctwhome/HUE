import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const createdHarnesses: string[] = [];
let listCalls = 0;
const harnessCalls: string[] = [];
let heldHermes: Promise<unknown[]> | null = null;
let cronRefreshes = 0;
let cronFailure = false;
const cronJobs = [
	{
		jobId: 'daily',
		profile: 'default',
		unreadCount: 2,
		error: null,
		history: { limit: 100, possiblyTruncated: true, paginationSupported: false },
		refreshedAt: '2026-09-09T00:00:00Z'
	}
];

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	unprojectedSessionRoot: () => '/Users/ctw/.hue/sessions',
	quickAskSessionRoot: () => '/Users/ctw/.hue/sessions/.quick-ask',
	sessionMatchesProjectRoot: (root: string, cwd: string) => root === cwd,
	services: () => ({
		externalCron: {
			refreshSurface: async () => {
				cronRefreshes++;
				if (cronFailure) throw new Error('Inventory unavailable');
				return { jobs: cronJobs };
			}
		},
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
			listSessions: async (root: string, harness = 'hermes') => {
				listCalls += 1;
				harnessCalls.push(harness);
				if (harness === 'hermes' && heldHermes) return heldHermes;
				return harness === 'opencode'
					? []
					: root.endsWith('/.quick-ask')
						? [{ sessionId: 'kept-quick-ask', cwd: root, title: 'Quick Ask' }]
						: [];
			},
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

test('refreshes scheduled projections once and exposes history coverage', async () => {
	const { GET } = await import('./+server');
	cronRefreshes = 0;
	const first = await GET({
		url: new URL('http://localhost/api/sessions?scope=scheduled')
	} as never);
	expect(await first.json()).toMatchObject({ externalCronJobs: cronJobs, externalCronError: null });
	for (const query of ['cached=true', 'offset=100'])
		await GET({ url: new URL(`http://localhost/api/sessions?scope=scheduled&${query}`) } as never);
	expect(cronRefreshes).toBe(1);
});

test('keeps local scheduled rows and the existing error field on projection outage', async () => {
	const { GET } = await import('./+server');
	cronFailure = true;
	try {
		const response = await GET({
			url: new URL('http://localhost/api/sessions?scope=scheduled')
		} as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			externalCronJobs: [],
			externalCronError: 'Inventory unavailable',
			sessions: expect.any(Array)
		});
	} finally {
		cronFailure = false;
	}
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

test('projectless cached and subsequent pages stay local', async () => {
	const { GET } = await import('./+server');
	for (const query of ['cached=true', 'offset=100']) {
		listCalls = 0;
		const response = await GET({ url: new URL(`http://localhost/api/sessions?${query}`) } as never);
		expect(response.status).toBe(200);
		expect(listCalls).toBe(0);
		expect(await response.json()).toMatchObject({ reconciliation: 'cached' });
	}
});

test('starts optional harness discovery without waiting for Hermes enumeration', async () => {
	const { GET } = await import('./+server');
	let release!: (value: unknown[]) => void;
	heldHermes = new Promise((resolve) => {
		release = resolve;
	});
	harnessCalls.length = 0;
	const pending = GET({ url: new URL('http://localhost/api/sessions') } as never);
	await Bun.sleep(1);
	try {
		expect(harnessCalls).toContain('opencode');
	} finally {
		heldHermes = null;
		release([]);
		await pending;
	}
});
