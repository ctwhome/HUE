import { afterEach, expect, test } from 'bun:test';
import { fstatSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeSessionMedia, resolveSessionMedia, serveSessionMedia } from './session-media';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test('resolves only supported regular MEDIA files inside canonical Session root', () => {
	const root = join(tmpdir(), `hue-media-${crypto.randomUUID()}`);
	const outside = join(tmpdir(), `hue-outside-${crypto.randomUUID()}.txt`);
	roots.push(root, outside);
	mkdirSync(join(root, 'output'), { recursive: true });
	writeFileSync(join(root, 'output', 'report.pdf'), '%PDF-1.7\n');
	writeFileSync(join(root, 'output', 'fake.pdf'), 'not a pdf');
	writeFileSync(join(root, 'output', 'line\nbreak.txt'), 'unsafe name');
	symlinkSync(join(root, 'output', 'report.pdf'), join(root, 'output', 'alias.pdf'));
	writeFileSync(outside, 'secret');
	symlinkSync(outside, join(root, 'output', 'escape.txt'));

	const valid = resolveSessionMedia(root, 'output/report.pdf');
	expect(valid).toMatchObject({
		name: 'report.pdf',
		mimeType: 'application/pdf'
	});
	closeSessionMedia(valid);
	for (const path of [
		'/private/secret.txt',
		'../secret.txt',
		'output/escape.txt',
		'output/alias.pdf',
		'output/fake.pdf',
		'output/line\nbreak.txt',
		'run.exe'
	]) {
		expect(() => resolveSessionMedia(root, path)).toThrow();
	}
});

test('serves the validated descriptor after the path is swapped for a symlink', async () => {
	const root = join(tmpdir(), `hue-media-${crypto.randomUUID()}`);
	const outside = join(tmpdir(), `hue-outside-${crypto.randomUUID()}.txt`);
	roots.push(root, outside);
	mkdirSync(join(root, 'output'), { recursive: true });
	writeFileSync(join(root, 'output', 'report.txt'), 'validated bytes');
	writeFileSync(outside, 'secret bytes');

	const media = resolveSessionMedia(root, 'output/report.txt');
	renameSync(join(root, 'output', 'report.txt'), join(root, 'output', 'validated.txt'));
	symlinkSync(outside, join(root, 'output', 'report.txt'));

	const response = serveSessionMedia(media, new Request('http://hue.test/media'), false);
	expect(await response.text()).toBe('validated bytes');
	expect(() => fstatSync(media.descriptor)).toThrow();
});

test('serves validated SVG MEDIA with image-safe document headers', async () => {
	const root = join(tmpdir(), `hue-media-${crypto.randomUUID()}`);
	roots.push(root);
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, 'diagram.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'
	);
	writeFileSync(join(root, 'fake.svg'), '<html>not an image</html>');

	const media = resolveSessionMedia(root, 'diagram.svg');
	expect(media.mimeType).toBe('image/svg+xml');
	const response = serveSessionMedia(media, new Request('http://hue.test/media'), false);
	expect(response.headers.get('content-type')).toBe('image/svg+xml');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
	expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	expect(response.headers.get('x-frame-options')).toBe('DENY');
	expect(response.headers.get('content-security-policy')).toBe(
		"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox"
	);
	expect(await response.text()).toContain('<svg');
	expect(() => resolveSessionMedia(root, 'fake.svg')).toThrow('content does not match');
});

test('closes the MEDIA descriptor when a response body is cancelled', async () => {
	const root = join(tmpdir(), `hue-media-${crypto.randomUUID()}`);
	roots.push(root);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, 'large.txt'), 'x'.repeat(1024 * 1024));

	const media = resolveSessionMedia(root, 'large.txt');
	const response = serveSessionMedia(media, new Request('http://hue.test/media'), false);
	await response.body!.cancel();
	await Bun.sleep(0);

	expect(() => fstatSync(media.descriptor)).toThrow();
});

test('closes the MEDIA descriptor for HEAD and invalid ranges', () => {
	const root = join(tmpdir(), `hue-media-${crypto.randomUUID()}`);
	roots.push(root);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, 'report.txt'), 'report');

	const headMedia = resolveSessionMedia(root, 'report.txt');
	serveSessionMedia(
		headMedia,
		new Request('http://hue.test/media', { method: 'HEAD' }),
		false,
		true
	);
	expect(() => fstatSync(headMedia.descriptor)).toThrow();

	const invalidRangeMedia = resolveSessionMedia(root, 'report.txt');
	serveSessionMedia(
		invalidRangeMedia,
		new Request('http://hue.test/media', { headers: { range: 'bytes=99-100' } }),
		false
	);
	expect(() => fstatSync(invalidRangeMedia.descriptor)).toThrow();
});
