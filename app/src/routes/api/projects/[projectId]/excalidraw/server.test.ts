import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';
import { ProjectExcalidrawConflictError } from '$lib/server/store';

let state: { projectId: string; address: string; scene: string; updatedAt: string } | null = null;
const projectIds: string[] = [];
const expectedRevisions: Array<string | null> = [];
let conflict = false;

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			getProjectExcalidraw: (projectId: string) => {
				projectIds.push(projectId);
				return state;
			},
			updateProjectExcalidraw: (
				projectId: string,
				input: { address?: string; scene?: string },
				expectedUpdatedAt: string | null
			) => {
				if (conflict) throw new ProjectExcalidrawConflictError();
				projectIds.push(projectId);
				expectedRevisions.push(expectedUpdatedAt);
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
	conflict = false;
	state = null;
	projectIds.length = 0;
	expectedRevisions.length = 0;
	const { GET, PATCH } = await import('./+server');
	const params = { projectId: 'project-slug' };
	const getResponse = await GET({ params } as never);
	const patchResponse = await PATCH({
		params,
		request: new Request('http://hue.test/excalidraw', {
			method: 'PATCH',
			body: JSON.stringify({
				address: 'example.com',
				scene: '{"version":1,"elements":[],"appState":{}}',
				expectedUpdatedAt: null
			})
		})
	} as never);

	expect(await getResponse.json()).toEqual({ state: null });
	expect(patchResponse.status).toBe(200);
	expect(await patchResponse.json()).toMatchObject({
		state: { projectId: 'canonical-project', address: 'http://example.com/' }
	});
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
	expect(expectedRevisions).toEqual([null]);
});

test('rejects malformed scenes before storage', async () => {
	conflict = false;
	state = null;
	projectIds.length = 0;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-slug' },
		request: new Request('http://hue.test/excalidraw', {
			method: 'PATCH',
			body: JSON.stringify({ scene: '{', expectedUpdatedAt: null })
		})
	} as never);

	expect(response.status).toBe(400);
	expect(projectIds).toEqual([]);
});

test('returns conflict when an Excalidraw revision is stale', async () => {
	conflict = true;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-slug' },
		request: new Request('http://hue.test/excalidraw', {
			method: 'PATCH',
			body: JSON.stringify({
				scene: '{"version":1,"elements":[],"appState":{}}',
				expectedUpdatedAt: '2026-08-24T00:00:00.000Z'
			})
		})
	} as never);

	expect(response.status).toBe(409);
	conflict = false;
});
