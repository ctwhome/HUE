import { describe, expect, it } from 'bun:test';
import { _createRuntimeHandlers } from './+server';

const diagnostics = {
	database: { status: 'ready' as const, integrity: 'ok' as const },
	acp: { status: 'idle' as const, profile: 'default' },
	admin: { status: 'idle' as const }
};

function event(request: Request, clientAddress = '127.0.0.1') {
	return {
		request,
		url: new URL(request.url),
		getClientAddress: () => clientAddress
	};
}

describe('runtime reliability API boundary', () => {
	it('returns proven read-only diagnostics to a local same-origin request', async () => {
		const handlers = _createRuntimeHandlers({
			diagnostics: async () => diagnostics,
			backup: () => ({
				filename: 'hue.sqlite',
				path: '/tmp/hue.sqlite',
				attachmentsPath: null,
				validated: true
			})
		});
		const request = new Request('http://localhost/api/runtime', { headers: { host: 'localhost' } });

		const response = await handlers.GET(event(request) as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(diagnostics);
	});

	it('rejects remote and cross-origin diagnostics and backup requests', async () => {
		const handlers = _createRuntimeHandlers({
			diagnostics: async () => diagnostics,
			backup: () => ({
				filename: 'hue.sqlite',
				path: '/tmp/hue.sqlite',
				attachmentsPath: null,
				validated: true
			})
		});
		for (const [request, address] of [
			[
				new Request('http://localhost/api/runtime', { headers: { host: 'localhost' } }),
				'203.0.113.10'
			],
			[
				new Request('http://localhost/api/runtime', {
					method: 'POST',
					headers: { host: 'localhost', origin: 'https://attacker.example' }
				}),
				'127.0.0.1'
			]
		] as const) {
			const handler = request.method === 'POST' ? handlers.POST : handlers.GET;
			const response = await handler(event(request, address) as never);
			expect(response.status).toBe(403);
		}
	});

	it('reports a backup only after validation', async () => {
		const handlers = _createRuntimeHandlers({
			diagnostics: async () => diagnostics,
			backup: () => ({
				filename: 'hue-2026.sqlite',
				path: '/data/backups/hue-2026.sqlite',
				attachmentsPath: '/data/backups/hue-2026.sqlite.attachments',
				validated: true
			})
		});
		const request = new Request('http://localhost/api/runtime', {
			method: 'POST',
			headers: { host: 'localhost', origin: 'http://localhost' }
		});

		const response = await handlers.POST(event(request) as never);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			backup: {
				filename: 'hue-2026.sqlite',
				path: '/data/backups/hue-2026.sqlite',
				attachmentsPath: '/data/backups/hue-2026.sqlite.attachments',
				validated: true
			}
		});
	});
});
