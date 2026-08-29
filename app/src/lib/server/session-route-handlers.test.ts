import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from './services-test-stubs';

const authoritativeReferences: string[] = [];
const sessionScopes: Array<string | null> = [];

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async (reference: string) => {
		authoritativeReferences.push(reference);
		return { id: 'canonical-project', primary_path: '/work/hue' };
	},
	services: () => ({
		store: {
			hasSession: (projectId: string | null) => {
				sessionScopes.push(projectId);
				return true;
			}
		}
	})
}));

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
