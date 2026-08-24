import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let state: { projectId: string; address: string; scene: string; updatedAt: string } | null = null;
const projectIds: string[] = [];

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			getProjectExcalidraw: (projectId: string) => {
				projectIds.push(projectId);
				return state;
			},
			updateProjectExcalidraw: (projectId: string, input: { address?: string; scene?: string }) => {
				projectIds.push(projectId);
				state = {
					projectId,
					address: input.address ?? state?.address ?? '',
					scene: input.scene ?? state?.scene ?? '',
					updatedAt: '2026-08-24T00:00:00.000Z'
				};
				return state;
			}
		}
	})
}));

test('reads and partially updates canonical Project Excalidraw state', async () => {
	state = null;
	projectIds.length = 0;
	const { GET, PATCH } = await import('./+server');
	const params = { projectId: 'project-slug' };
	const getResponse = await GET({ params } as never);
	const patchResponse = await PATCH({
		params,
		request: new Request('http://hue.test/excalidraw', {
			method: 'PATCH',
			body: JSON.stringify({
				address: 'example.com',
				scene: '{"version":1,"elements":[],"appState":{}}'
			})
		})
	} as never);

	expect(await getResponse.json()).toEqual({ state: null });
	expect(patchResponse.status).toBe(200);
	expect(await patchResponse.json()).toMatchObject({
		state: { projectId: 'canonical-project', address: 'http://example.com/' }
	});
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
});

test('rejects malformed scenes before storage', async () => {
	state = null;
	projectIds.length = 0;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-slug' },
		request: new Request('http://hue.test/excalidraw', {
			method: 'PATCH',
			body: JSON.stringify({ scene: '{' })
		})
	} as never);

	expect(response.status).toBe(400);
	expect(projectIds).toEqual([]);
});
