import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from './services-test-stubs';
import { HUEStore } from './store';

const authoritativeReferences: string[] = [];
const sessionScopes: Array<string | null> = [];
let scopeFailure: Error | null = null;
let associated = true;
let eventReads = 0;
let localStore: HUEStore | null = null;
let cancellations = 0;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async (reference: string) => {
		authoritativeReferences.push(reference);
		if (scopeFailure) throw scopeFailure;
		return { id: 'canonical-project', primary_path: '/work/hue' };
	},
	services: () => ({
		store: localStore ?? {
			hasSession: (projectId: string | null) => {
				sessionScopes.push(projectId);
				return associated && (projectId === null || projectId === 'canonical-project');
			},
			listEvents: () => {
				eventReads++;
				return [];
			}
		},
		sessionRuntime: { getSessionState: () => ({}), getAvailableCommands: () => [], cancelSession: async () => { cancellations++; } },
		dispatcher: { resolveInteraction: () => true }
	})
}));

test('exact cached Project lookup finds an older or archived Session beyond the first page', async () => {
	const store = new HUEStore(':memory:');
	localStore = store;
	try {
		store.ensureProjectMetadata('project', 'Project');
		for (let i = 0; i < 101; i++) store.upsertSession('project', {
			sessionId: `s-${i}`, cwd: '/tmp', title: `Session ${i}`,
			updatedAt: new Date(1700000000000 + i * 1000).toISOString()
		});
		const { GET } = await import('../../routes/api/projects/[projectId]/sessions/+server');
		for (const archived of [false, true]) {
			store.updateSession('project', 's-0', { archived });
			const response = await GET({ params: { projectId: 'project' },
				url: new URL('http://hue.test/api/projects/project/sessions?sessionId=s-0&cached=true') } as never);
			const body = await response.json();
			expect(body.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual(['s-0']);
			expect(body.hasMore).toBe(false);
		}
		store.ensureProjectMetadata('other', 'Other');
		const missing = await GET({ params: { projectId: 'other' },
			url: new URL('http://hue.test/api/projects/other/sessions?sessionId=s-0&cached=true') } as never);
		expect((await missing.json()).sessions).toEqual([]);
	} finally { localStore = null; store.close(); }
});

test('local replay keeps working during an admin outage but rejects a removed association', async () => {
	const { getEvents } = await import('./session-route-handlers');
	const event = {
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/events')
	} as never;
	eventReads = 0;
	try {
		authoritativeReferences.length = 0;
		expect((await getEvents('canonical-project', event)).status).toBe(200);
		expect(eventReads).toBe(1);
		scopeFailure = new Error('Hermes admin unavailable');
		expect((await getEvents('canonical-project', event)).status).toBe(200);
		expect(eventReads).toBe(2);
		expect(authoritativeReferences).toEqual([]);
		scopeFailure = null;
		associated = false;
		expect((await getEvents('canonical-project', event)).status).toBe(404);
		expect(eventReads).toBe(2);
	} finally {
		scopeFailure = null;
		associated = true;
	}
});

test('known Session cancellation and explicit interactions do not depend on Hermes admin', async () => {
	const { postCancel, postInteraction } = await import('./session-route-handlers');
	try {
		scopeFailure = new Error('Hermes admin unavailable');
		cancellations = 0;
		const event = { params: { sessionId: 'session-1' }, url: new URL('http://hue.test/session'),
			request: { json: async () => ({ interactionId: 'permission', response: { kind: 'permission', optionId: 'allow-once' } }) } } as never;
		expect((await postCancel('canonical-project', event)).status).toBe(202);
		expect((await postInteraction('canonical-project', event)).status).toBe(200);
		expect((await postCancel('wrong-project', event)).status).toBe(404);
		expect(cancellations).toBe(1);
	} finally {
		scopeFailure = null;
	}
});

test('OpenCode Session reads use the stored association while Hermes admin is unavailable', async () => {
	const store = new HUEStore(':memory:');
	localStore = store;
	scopeFailure = new Error('Hermes admin unavailable');
	try {
		store.ensureProjectMetadata('project', 'Project');
		store.upsertSession('project', { sessionId: 'opencode:test', externalSessionId: 'test', harness: 'opencode', cwd: '/tmp' });
		const { getSession } = await import('./session-route-handlers');
		const event = { params: { sessionId: 'opencode:test' }, url: new URL('http://hue.test/session') } as never;
		expect((await getSession('project', event)).status).toBe(200);
		expect((await getSession('wrong-project', event)).status).toBe(404);
	} finally { scopeFailure = null; localStore = null; store.close(); }
});

for (const scope of [
	{ label: 'Project', supplied: 'project-slug', resolved: 'canonical-project' },
	{ label: 'projectless', supplied: null, resolved: null }
] as const) {
	test(`${scope.label} Session scope resolves ownership once`, async () => {
		authoritativeReferences.length = 0;
		sessionScopes.length = 0;
		const { resolveSessionScope } = await import('./session-route-handlers');

		const resolved = await resolveSessionScope(scope.supplied, 'session-1');

		expect(resolved.projectId).toBe(scope.resolved);
		expect(authoritativeReferences).toEqual(scope.supplied ? [scope.supplied] : []);
		expect(sessionScopes).toEqual([scope.resolved]);
	});
}
