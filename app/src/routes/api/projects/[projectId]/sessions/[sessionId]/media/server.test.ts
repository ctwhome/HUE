import { afterAll, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const root = join(tmpdir(), `hue-media-route-${crypto.randomUUID()}`);
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'report.pdf'), '%PDF-1.7\nroute range proof');
writeFileSync(
	join(root, 'diagram.svg'),
	'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0h1v1z"/></svg>'
);
writeFileSync(join(root, 'dashboard.html'), '<button>Interactive output</button>');
const projectIds: string[] = [];

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			hasSession: () => true,
			getSession: (projectId: string) => {
				projectIds.push(projectId);
				return { cwd: root };
			}
		}
	})
}));

afterAll(() => rmSync(root, { recursive: true, force: true }));

test('serves MEDIA with safe headers, HEAD, and bounded byte ranges', async () => {
	projectIds.length = 0;
	const { GET, HEAD } = await import('./+server');
	const url = new URL(
		'http://127.0.0.1/api/projects/p/sessions/s/media?path=report.pdf&download=true'
	);
	const full = await GET({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url)
	} as never);
	expect(full.status).toBe(200);
	expect(full.headers.get('accept-ranges')).toBe('bytes');
	expect(full.headers.get('x-content-type-options')).toBe('nosniff');
	expect(full.headers.get('content-disposition')).toContain("filename*=UTF-8''report.pdf");

	const head = await HEAD({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url, { method: 'HEAD' })
	} as never);
	expect(head.status).toBe(200);
	expect(await head.text()).toBe('');
	expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);

	const ranged = await GET({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url, { headers: { range: 'bytes=5-11' } })
	} as never);
	expect(ranged.status).toBe(206);
	expect(ranged.headers.get('content-range')).toMatch(/^bytes 5-11\/\d+$/);
	expect(await ranged.text()).toBe('1.7\nrou');

	const invalid = await GET({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url, { headers: { range: 'bytes=999-1000' } })
	} as never);
	expect(invalid.status).toBe(416);
	expect(invalid.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);

	const invalidAction = await (
		await import('./+server')
	).POST({
		params: { projectId: 'project-slug', sessionId: 's' },
		url,
		getClientAddress: () => '127.0.0.1',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'invalid' })
		})
	} as never);
	expect(invalidAction.status).toBe(400);
	expect(projectIds).toEqual(Array(5).fill('canonical-project'));
});

test('rejects remote MEDIA open while retaining remote GET access', async () => {
	const { GET, POST } = await import('./+server');
	const url = new URL('http://hue.test/api/projects/p/sessions/s/media?path=report.pdf');
	expect(
		(
			await GET({
				params: { projectId: 'p', sessionId: 's' },
				url,
				request: new Request(url)
			} as never)
		).status
	).toBe(200);
	const response = await POST({
		params: { projectId: 'p', sessionId: 's' },
		url,
		getClientAddress: () => '203.0.113.10',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'open', path: 'report.pdf' })
		})
	} as never);
	expect(response.status).toBe(403);
});

test('allows same-origin MEDIA reveal through an authenticated proxy boundary', async () => {
	const { POST } = await import('./+server');
	const url = new URL('https://hue.test/api/projects/p/sessions/s/media?path=missing.pdf');
	const response = await POST({
		params: { projectId: 'p', sessionId: 's' },
		url,
		getClientAddress: () => '203.0.113.10',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'reveal', path: 'missing.pdf' })
		})
	} as never);
	expect(response.status).toBe(400);
	expect(await response.json()).not.toEqual({ error: 'Opening files is limited to this device' });
});

test('previews SVG MEDIA but never opens it outside the hardened response context', async () => {
	const { GET, POST } = await import('./+server');
	const url = new URL('http://127.0.0.1/api/projects/p/sessions/s/media?path=diagram.svg');
	const preview = await GET({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url)
	} as never);
	expect(preview.status).toBe(200);
	expect(preview.headers.get('content-type')).toBe('image/svg+xml');
	await preview.body?.cancel();

	const opened = await POST({
		params: { projectId: 'p', sessionId: 's' },
		url,
		getClientAddress: () => '127.0.0.1',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'open', path: 'diagram.svg' })
		})
	} as never);
	expect(opened.status).toBe(400);
	expect(await opened.json()).toEqual({
		error: 'SVG outputs can only be previewed or revealed'
	});
});

test('previews generated HTML but never opens it outside the sandbox', async () => {
	const { GET, POST } = await import('./+server');
	const url = new URL('http://127.0.0.1/api/projects/p/sessions/s/media?path=dashboard.html');
	const preview = await GET({
		params: { projectId: 'p', sessionId: 's' },
		url,
		request: new Request(url)
	} as never);
	expect(preview.status).toBe(200);
	expect(preview.headers.get('content-type')).toBe('text/html; charset=utf-8');
	await preview.body?.cancel();

	const opened = await POST({
		params: { projectId: 'p', sessionId: 's' },
		url,
		getClientAddress: () => '127.0.0.1',
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: url.origin },
			body: JSON.stringify({ action: 'open', path: 'dashboard.html' })
		})
	} as never);
	expect(opened.status).toBe(400);
	expect(await opened.json()).toEqual({
		error: 'HTML outputs can only be previewed or revealed'
	});
});
