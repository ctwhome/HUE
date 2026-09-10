import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from './services-test-stubs';

const authoritativeReferences: string[] = [];
const sessionScopes: Array<string | null> = [];
let scopeFailure: Error | null = null;
let associated = true;
let eventReads = 0;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async (reference: string) => {
		authoritativeReferences.push(reference);
		if (scopeFailure) throw scopeFailure;
		return { id: 'canonical-project', primary_path: '/work/hue' };
	},
	services: () => ({
		store: {
			hasSession: (projectId: string | null) => {
				sessionScopes.push(projectId);
				return associated;
			},
			listEvents: () => {
				eventReads++;
				return [];
			}
		},
		sessionRuntime: { getSessionState: () => ({}) }
	})
}));

test('replay rechecks revocation and association after a formerly valid alias read', async () => {
	const { getEvents } = await import('./session-route-handlers');
	const event = {
		params: { sessionId: 'session-1' },
		url: new URL('http://hue.test/events')
	} as never;
	eventReads = 0;
	try {
		expect((await getEvents('project-slug', event)).status).toBe(200);
		expect(eventReads).toBe(1);
		scopeFailure = new Error('Project not found');
		expect((await getEvents('project-slug', event)).status).toBe(404);
		expect(eventReads).toBe(1);
		scopeFailure = null;
		associated = false;
		expect((await getEvents('project-slug', event)).status).toBe(404);
		expect(eventReads).toBe(1);
	} finally {
		scopeFailure = null;
		associated = true;
	}
});

test('distinguishes event replay administration outages from missing scope', async () => {
	const { getEvents } = await import('./session-route-handlers');
	try {
		for (const [message, status] of [
			['Hermes Projects request timed out', 503],
			['Project not found', 404]
		] as const) {
			scopeFailure = new Error(message);
			const response = await getEvents('project-slug', {
				params: { sessionId: 'session-1' },
				url: new URL('http://hue.test/events')
			} as never);
			expect(response.status).toBe(status);
		}
	} finally {
		scopeFailure = null;
	}
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
