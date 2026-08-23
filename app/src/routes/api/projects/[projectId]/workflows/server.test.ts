import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const projectIds: string[] = [];

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			listWorkflows: (projectId: string) => {
				projectIds.push(projectId);
				return [];
			},
			createWorkflow: (input: { projectId: string }) => {
				projectIds.push(input.projectId);
				return input;
			}
		}
	})
}));

test('uses canonical Hermes id for workflow reads and creates reached by slug', async () => {
	projectIds.length = 0;
	const { GET, POST } = await import('./+server');
	const params = { projectId: 'project-slug' };
	const getResponse = await GET({ params } as never);
	const postResponse = await POST({
		params,
		request: new Request('http://hue.test/workflows', {
			method: 'POST',
			body: JSON.stringify({ name: 'Review', prompt: 'Review code' })
		})
	} as never);

	expect(getResponse.status).toBe(200);
	expect(postResponse.status).toBe(201);
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
});
