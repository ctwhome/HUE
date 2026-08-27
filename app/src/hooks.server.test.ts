import { afterEach, expect, test } from 'bun:test';
import { ACCESS_COOKIE, createAccessSession } from '$lib/server/access-auth';
import { handle } from './hooks.server';

const originalSecret = process.env.HUE_ACCESS_SECRET;

afterEach(() => {
	if (originalSecret === undefined) delete process.env.HUE_ACCESS_SECRET;
	else process.env.HUE_ACCESS_SECRET = originalSecret;
});

async function handled(path: string, address: string, cookie?: string) {
	const url = new URL(path, 'https://hue.example.test');
	const request = new Request(url, {
		headers: {
			host: url.host,
			...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {})
		}
	});
	return handle({
		event: {
			request,
			url,
			getClientAddress: () => address
		},
		resolve: async () => new Response('private workspace')
	} as never);
}

test('remote requests cannot read application or API data without authentication', async () => {
	delete process.env.HUE_ACCESS_SECRET;

	const page = await handled('/', '100.64.0.2');
	const api = await handled('/api/projects', '100.64.0.2');

	expect(page.status).toBe(303);
	expect(page.headers.get('location')).toBe('/login');
	expect(api.status).toBe(401);
	expect(await api.json()).toEqual({ error: 'Authentication required' });
});

test('login route and its static assets remain reachable', async () => {
	expect((await handled('/login', '100.64.0.2')).status).toBe(200);
	expect((await handled('/_app/immutable/login.js', '100.64.0.2')).status).toBe(200);
	expect((await handled('/favicon.png', '100.64.0.2')).status).toBe(200);
});

test('configured remote sessions and zero-setup loopback requests reach the application', async () => {
	process.env.HUE_ACCESS_SECRET = 'configured-secret';
	const token = createAccessSession(process.env.HUE_ACCESS_SECRET);

	expect((await handled('/', '100.64.0.2', token)).status).toBe(200);

	delete process.env.HUE_ACCESS_SECRET;
	const url = new URL('http://127.0.0.1:4010/');
	const response = await handle({
		event: {
			request: new Request(url, { headers: { host: url.host } }),
			url,
			getClientAddress: () => '127.0.0.1'
		},
		resolve: async () => new Response('private workspace')
	} as never);

	expect(response.status).toBe(200);
});
