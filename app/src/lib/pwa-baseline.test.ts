import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { allowedAttachmentMimeTypes } from '$lib/message-content';

const root = join(import.meta.dir, '..');
const staticRoot = join(root, '..', 'static');

function pngPixel(path: string, x: number, y: number) {
	const png = readFileSync(path);
	const bitDepth = png[24];
	const colorType = png[25];
	expect(bitDepth).toBe(8);
	expect([2, 6]).toContain(colorType);
	const channels = colorType === 6 ? 4 : 3;
	const width = png.readUInt32BE(16);
	const rows = Buffer.alloc((width * channels + 1) * png.readUInt32BE(20));
	let inputOffset = 0;
	let outputOffset = 0;
	for (let offset = 8; offset < png.length;) {
		const length = png.readUInt32BE(offset);
		if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
			png.copy(rows, outputOffset, offset + 8, offset + 8 + length);
			outputOffset += length;
		}
		offset += length + 12;
	}
	const inflated = inflateSync(rows.subarray(0, outputOffset));
	const stride = width * channels;
	const decoded = Buffer.alloc(stride * png.readUInt32BE(20));
	for (let row = 0; row < png.readUInt32BE(20); row += 1) {
		const filter = inflated[row * (stride + 1)];
		for (let column = 0; column < stride; column += 1) {
			const raw = inflated[row * (stride + 1) + column + 1];
			const left = column >= channels ? decoded[row * stride + column - channels] : 0;
			const above = row ? decoded[(row - 1) * stride + column] : 0;
			const upperLeft =
				row && column >= channels ? decoded[(row - 1) * stride + column - channels] : 0;
			const paeth = (() => {
				const estimate = left + above - upperLeft;
				const distances = [
					Math.abs(estimate - left),
					Math.abs(estimate - above),
					Math.abs(estimate - upperLeft)
				];
				return distances[0] <= distances[1] && distances[0] <= distances[2]
					? left
					: distances[1] <= distances[2]
						? above
						: upperLeft;
			})();
			const predictor = [0, left, above, Math.floor((left + above) / 2), paeth][filter];
			expect(predictor).toBeDefined();
			decoded[row * stride + column] = (raw + predictor) & 255;
		}
	}
	return [...decoded.subarray(y * stride + x * channels, y * stride + x * channels + 3)];
}

const luminance = ([red, green, blue]: number[]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

test('manifest exposes stable install, ordered shortcut, icon, and share contracts', () => {
	const path = join(staticRoot, 'manifest.webmanifest');
	expect(existsSync(path)).toBe(true);
	const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
	expect(manifest).toMatchObject({
		id: '/',
		scope: '/',
		start_url: '/',
		display: 'standalone',
		share_target: {
			action: '/share',
			method: 'POST',
			enctype: 'multipart/form-data',
			params: { title: 'title', text: 'text', url: 'url' }
		}
	});
	expect(manifest.shortcuts.map(({ name }: { name: string }) => name)).toEqual([
		'New Session',
		'Quick Idea',
		'Projects',
		'Recent Sessions'
	]);
	expect(manifest.shortcuts.map(({ url }: { url: string }) => url)).toEqual([
		'/?intent=new-session',
		'/?intent=capture',
		'/?intent=projects',
		'/?intent=recents'
	]);
	expect(manifest.share_target.params.files[0]).toMatchObject({ name: 'files' });
	expect([...manifest.share_target.params.files[0].accept].sort()).toEqual(
		allowedAttachmentMimeTypes().sort()
	);
	expect(manifest.icons).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ src: '/icons/hue-192.png', sizes: '192x192' }),
			expect.objectContaining({ src: '/icons/hue-512.png', sizes: '512x512' }),
			expect.objectContaining({
				src: '/icons/hue-maskable-512.png',
				sizes: '512x512',
				purpose: 'maskable'
			})
		])
	);
	for (const icon of ['hue-192.png', 'hue-512.png', 'hue-maskable-512.png']) {
		const bytes = readFileSync(join(staticRoot, 'icons', icon));
		expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		expect(bytes.length).toBeGreaterThan(1_000);
		const expected = icon === 'hue-192.png' ? 192 : 512;
		expect(bytes.readUInt32BE(16)).toBe(expected);
		expect(bytes.readUInt32BE(20)).toBe(expected);
	}
	for (const [icon, scale, purpleX] of [
		['hue-192.png', 192 / 512, 140],
		['hue-512.png', 1, 140],
		['hue-maskable-512.png', 1, 180]
	] as const) {
		const path = join(staticRoot, 'icons', icon);
		const purple = pngPixel(path, Math.round(purpleX * scale), Math.round(180 * scale));
		const dark = pngPixel(path, Math.round(256 * scale), Math.round(180 * scale));
		expect(purple[2]).toBeGreaterThan(purple[1]);
		expect(purple[0]).toBeGreaterThan(dark[0] + 80);
		expect(luminance(purple) - luminance(dark)).toBeGreaterThan(80);
	}
});

test('service worker caches versioned build assets and excludes navigation and APIs', () => {
	const source = readFileSync(join(root, 'service-worker.ts'), 'utf8');
	expect(source).toContain("from '$service-worker'");
	expect(source).toContain('build.includes(url.pathname)');
	expect(source).not.toMatch(/caches\.put\([^\n]*(?:api|request)/i);
	expect(source).not.toContain('/api/notifications?view=unread');
	expect(source).toContain('notificationclick');
	expect(source).toContain('skipWaiting');
});

test('document links manifest and stable theme metadata', () => {
	const layout = readFileSync(join(root, 'routes', '+layout.svelte'), 'utf8');
	expect(layout).toContain('rel="manifest"');
	expect(layout).toContain('name="theme-color"');
});
