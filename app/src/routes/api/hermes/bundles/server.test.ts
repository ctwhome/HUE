import { beforeEach, expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const calls: Array<{ action: string; value?: unknown }> = [];
const bundle = {
	name: 'Release',
	slug: 'release',
	description: '',
	skills: ['review'],
	instruction: ''
};

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({
		bundles: {
			list: async () => [bundle],
			listSkills: async () => [
				{
					name: 'review',
					description: 'Review code',
					enabled: true,
					provenance: 'custom',
					permissions: { read: true, write: true, delete: true }
				}
			],
			create: async (value: unknown) => {
				calls.push({ action: 'create', value });
				return bundle;
			}
		}
	})
}));

const { GET, POST } = await import('./+server');

beforeEach(() => calls.splice(0));

test('lists bundles and metadata-only skill permissions', async () => {
	const response = await GET({} as never);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		bundles: [bundle],
		skills: [
			{
				name: 'review',
				description: 'Review code',
				enabled: true,
				provenance: 'custom',
				permissions: { read: true, write: true, delete: true }
			}
		]
	});
});

test('allows bundle creation only from this device', async () => {
	const remote = new Request('http://localhost/api/hermes/bundles', {
		method: 'POST',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: '{not-json'
	});
	const rejected = await POST({
		request: remote,
		url: new URL(remote.url),
		getClientAddress: () => '203.0.113.10'
	} as never);
	expect(rejected.status).toBe(403);
	expect(calls).toHaveLength(0);

	const local = new Request('http://localhost/api/hermes/bundles', {
		method: 'POST',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: JSON.stringify({ name: 'Release', skills: ['review'] })
	});
	const created = await POST({
		request: local,
		url: new URL(local.url),
		getClientAddress: () => '127.0.0.1'
	} as never);
	expect(created.status).toBe(201);
	expect(calls).toEqual([{ action: 'create', value: { name: 'Release', skills: ['review'] } }]);
});
