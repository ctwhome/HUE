import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowedAttachmentMimeTypes } from '$lib/message-content';

const root = join(import.meta.dir, '..');
const staticRoot = join(root, '..', 'static');

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
	const favicon = readFileSync(join(staticRoot, 'favicon.png'));
	expect(favicon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
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

test('application detects deployed builds and offers a restart', () => {
	const vite = readFileSync(join(root, '..', 'vite.config.ts'), 'utf8');
	const layout = readFileSync(join(root, 'routes', '+layout.svelte'), 'utf8');
	expect(vite).toContain('pollInterval: 60_000');
	expect(layout).toContain('updated.current');
	expect(layout).toContain('Update the application to restart.');
	expect(layout).toContain('location.reload()');
});
