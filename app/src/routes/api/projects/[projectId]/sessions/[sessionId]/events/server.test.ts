import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const projectIds: string[] = [];

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			hasSession: (projectId: string) => {
				projectIds.push(projectId);
				return true;
			},
			listEvents: (projectId: string) => {
				projectIds.push(projectId);
				return [];
			}
		},
		sessionRuntime: { getSessionState: () => ({}) }
	})
}));

test('reads events under the supplied local canonical Project id', async () => {
	projectIds.length = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'canonical-project', sessionId: 'session' },
		url: new URL('http://hue.test/events?after=3')
	} as never);

	expect(response.status).toBe(200);
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
});
