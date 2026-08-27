import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const calls: Array<Record<string, unknown>> = [];

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			updateWorkflow: (projectId: string, workflowId: string, patch: Record<string, unknown>) => {
				calls.push({ action: 'update', projectId, workflowId, patch });
				return { id: workflowId, projectId, ...patch };
			},
			deleteWorkflow: (projectId: string, workflowId: string) => {
				calls.push({ action: 'delete', projectId, workflowId });
				return true;
			}
		}
	})
}));

test('updates and deletes a workflow through the canonical Hermes project', async () => {
	calls.length = 0;
	const { PATCH, DELETE } = await import('./+server');
	const params = { projectId: 'slug', workflowId: 'release' };
	const patchResponse = await PATCH({
		params,
		request: new Request('http://hue.test/workflow', {
			method: 'PATCH',
			body: JSON.stringify({
				name: 'Ship release',
				prompt: 'Run checks.',
				profile: 'default',
				workMode: 'live',
				archived: true
			})
		})
	} as never);
	const deleteResponse = await DELETE({ params } as never);

	expect(patchResponse.status).toBe(200);
	expect(deleteResponse.status).toBe(200);
	expect(calls).toEqual([
		{
			action: 'update',
			projectId: 'canonical-project',
			workflowId: 'release',
			patch: {
				name: 'Ship release',
				prompt: 'Run checks.',
				profile: 'default',
				workMode: 'live',
				archived: true
			}
		},
		{ action: 'delete', projectId: 'canonical-project', workflowId: 'release' }
	]);
});

test('rejects invalid workflow fields', async () => {
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'slug', workflowId: 'release' },
		request: new Request('http://hue.test/workflow', {
			method: 'PATCH',
			body: JSON.stringify({ workMode: 'unsafe' })
		})
	} as never);

	expect(response.status).toBe(400);
});
