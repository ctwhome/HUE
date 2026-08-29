import { describe, expect, it } from 'bun:test';
import { createAccessSession } from '$lib/server/access-auth';
import { DELETE, PUT } from './+server';

describe('Hermes custom-skill mutation boundary', () => {
	it('rejects remote and cross-origin writes before parsing JSON', async () => {
		for (const [handler, origin, address] of [
			[PUT, undefined, '203.0.113.10'],
			[DELETE, 'https://attacker.example', '127.0.0.1']
		] as const) {
			const request = new Request('http://localhost/api/hermes/skills/custom', {
				method: handler === PUT ? 'PUT' : 'DELETE',
				headers: { host: 'localhost', ...(origin ? { origin } : {}) },
				body: '{not-json'
			});
			const response = await handler({
				params: { name: 'custom' },
				request,
				url: new URL(request.url),
				getClientAddress: () => address
			} as never);
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'API access is limited to this device' });
		}
	});

	it('rejects remote writes even with a valid access session', async () => {
		const secret = process.env.HUE_ACCESS_SECRET;
		process.env.HUE_ACCESS_SECRET = 'test-secret';
		try {
			const request = new Request('https://hue.example/api/hermes/skills/custom', {
				method: 'PUT',
				headers: {
					host: 'hue.example',
					origin: 'https://hue.example',
					cookie: `hue_access=${createAccessSession('test-secret')}`
				},
				body: JSON.stringify({ content: '---\nname: custom\n---\n' })
			});
			const response = await PUT({
				params: { name: 'custom' },
				request,
				url: new URL(request.url),
				getClientAddress: () => '203.0.113.10'
			} as never);
			expect(response.status).toBe(403);
		} finally {
			if (secret === undefined) delete process.env.HUE_ACCESS_SECRET;
			else process.env.HUE_ACCESS_SECRET = secret;
		}
	});
});
