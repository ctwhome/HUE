import { beforeEach, expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const calls: Array<{ action: string; name: string; value?: unknown }> = [];
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
			get: async (name: string) => {
				calls.push({ action: 'get', name });
				return bundle;
			},
			update: async (name: string, value: unknown) => {
				calls.push({ action: 'update', name, value });
				return bundle;
			},
			delete: async (name: string) => {
				calls.push({ action: 'delete', name });
				return { deleted: true };
			}
		}
	})
}));

const { GET, PUT, DELETE } = await import('./+server');
const event = (request: Request) => ({
	params: { name: 'release' },
	request,
	url: new URL(request.url),
	getClientAddress: () => '127.0.0.1'
});

beforeEach(() => calls.splice(0));

test('gets and updates one bundle', async () => {
	const loaded = await GET({ params: { name: 'release' } } as never);
	const request = new Request('http://localhost/api/hermes/bundles/Release', {
		method: 'PUT',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: JSON.stringify({ skills: ['review'] })
	});
	const updated = await PUT(event(request) as never);

	expect(loaded.status).toBe(200);
	expect(updated.status).toBe(200);
	expect(calls).toEqual([
		{ action: 'get', name: 'release' },
		{ action: 'update', name: 'release', value: { skills: ['review'] } }
	]);
});

test('requires exact-name confirmation before delete', async () => {
	for (const confirm of ['release', ' Release ', '']) {
		const request = new Request('http://localhost/api/hermes/bundles/Release', {
			method: 'DELETE',
			headers: { host: 'localhost', origin: 'http://localhost' },
			body: JSON.stringify({ confirm })
		});
		expect((await DELETE(event(request) as never)).status).toBe(400);
	}
	expect(calls).toEqual(Array.from({ length: 3 }, () => ({ action: 'get', name: 'release' })));
	calls.splice(0);

	const request = new Request('http://localhost/api/hermes/bundles/Release', {
		method: 'DELETE',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: JSON.stringify({ confirm: 'Release' })
	});
	expect((await DELETE(event(request) as never)).status).toBe(200);
	expect(calls).toEqual([
		{ action: 'get', name: 'release' },
		{ action: 'delete', name: 'release' }
	]);
});
