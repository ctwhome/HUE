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
