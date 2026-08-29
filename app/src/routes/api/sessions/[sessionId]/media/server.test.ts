import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({
		store: { hasSession: () => true, getSession: () => ({ cwd: '/tmp' }) }
	})
}));

test('projectless MEDIA open rejects remote requests before filesystem access', async () => {
	const { POST } = await import('./+server');
	const url = new URL('http://hue.test/api/sessions/s/media');
	const response = await POST({
		params: { sessionId: 's' },
		url,
		getClientAddress: () => '203.0.113.10',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'open', path: 'missing.pdf' })
		})
	} as never);
	expect(response.status).toBe(403);
});
