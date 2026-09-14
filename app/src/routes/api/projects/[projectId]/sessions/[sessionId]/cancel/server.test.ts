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
			}
		},
		sessionRuntime: { cancelSession: async () => undefined }
	})
}));

test('checks cancel ownership against the supplied local canonical Project id', async () => {
	projectIds.length = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'canonical-project', sessionId: 'session' }
	} as never);

	expect(response.status).toBe(202);
	expect(projectIds).toEqual(['canonical-project']);
});
