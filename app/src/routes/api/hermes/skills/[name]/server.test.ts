import { describe, expect, it } from 'bun:test';
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
});
