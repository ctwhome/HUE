import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const projectIds: string[] = [];
let created: Record<string, unknown> | null = null;

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
				created = input;
				return input;
			}
		}
	})
}));

test('uses canonical Hermes id for workflow reads and creates reached by slug', async () => {
	projectIds.length = 0;
	const { GET, POST } = await import('./+server');
	const params = { projectId: 'project-slug' };
	const getResponse = await GET({ params, url: new URL('http://hue.test/workflows') } as never);
	const postResponse = await POST({
		params,
		request: new Request('http://hue.test/workflows', {
			method: 'POST',
			body: JSON.stringify({
				name: 'Review',
				prompt: 'Review code',
				folder: 'Engineering',
				favorite: true
			})
		})
	} as never);

	expect(getResponse.status).toBe(200);
	expect(postResponse.status).toBe(201);
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
	expect(created).toMatchObject({ folder: 'Engineering', favorite: true });
});
