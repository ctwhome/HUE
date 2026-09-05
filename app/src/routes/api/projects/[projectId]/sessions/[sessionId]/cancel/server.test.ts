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

test('checks cancel ownership under canonical Hermes id when route uses slug', async () => {
	projectIds.length = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug', sessionId: 'session' }
	} as never);

	expect(response.status).toBe(202);
	expect(projectIds).toEqual(['canonical-project']);
});
