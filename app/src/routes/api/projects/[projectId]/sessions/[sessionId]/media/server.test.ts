import { afterAll, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(tmpdir(), `hue-media-route-${crypto.randomUUID()}`);
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'report.pdf'), '%PDF-1.7\nroute range proof');

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: { getSession: () => ({ cwd: root }) }
	})
}));

afterAll(() => rmSync(root, { recursive: true, force: true }));

test('serves MEDIA with safe headers, HEAD, and bounded byte ranges', async () => {
	const { GET, HEAD } = await import('./+server');
	const url = new URL(
		'http://hue.test/api/projects/p/sessions/s/media?path=report.pdf&download=true'
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
});
