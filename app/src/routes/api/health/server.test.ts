import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ primary_path: '/synthetic' }),
	projectRuntimeHealth: async () => [{ id: 'root', status: 'blocked' }],
	services: () => ({
		runtime: { healthStatus: () => 'ready' },
		admin: { healthStatus: () => 'ready' }
	})
}));

test('awaits asynchronous Project health checks before computing status', async () => {
	const { GET } = await import('./+server');
	const response = await GET({ url: new URL('http://localhost/api/health?projectId=p') } as never);
	expect(await response.json()).toMatchObject({
		ok: false,
		checks: [{ id: 'root', status: 'blocked' }]
	});
});
