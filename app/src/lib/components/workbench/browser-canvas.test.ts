import { describe, expect, test } from 'bun:test';
import {
	BROWSER_CANVAS_MAX_BYTES,
	BROWSER_CANVAS_MAX_ELEMENTS,
	browserCanvasAddressKey,
	browserCanvasStorageKey,
	createBrowserEmbedSpec,
	legacyBrowserStorageKey,
	migrateLegacyBrowserTabs,
	createExcalidrawEmbedElement,
	nextBrowserEmbedPosition,
	normalizeBrowserEmbedUrl,
	normalizeBrowserUrl,
	parseStoredBrowserAddress,
	parseStoredBrowserScene,
	restoreBrowserTabId,
	restoreBrowserView,
	serializeBrowserScene
} from './browser-canvas';

describe('browser URL normalization', () => {
	test('accepts only normalized credential-free http and https URLs', () => {
		expect(normalizeBrowserUrl('localhost:5173/path')).toBe('http://localhost:5173/path');
		expect(normalizeBrowserUrl('https://example.com')).toBe('https://example.com/');
		for (const value of [
			'',
			'not a url',
			'https://user:secret@example.com',
			'javascript:alert(1)',
			'ftp://example.com',
			'https://exa mple.com'
		]) {
			expect(() => normalizeBrowserUrl(value)).toThrow('Enter a valid http or https address');
		}
	});

	test('rejects embedding HUE itself when scripts and same-origin are enabled', () => {
		expect(() =>
			normalizeBrowserEmbedUrl('http://127.0.0.1:4173/app', 'http://127.0.0.1:4173')
		).toThrow('Open HUE itself externally or use a different local origin');
		expect(normalizeBrowserEmbedUrl('http://127.0.0.1:5173/app', 'http://127.0.0.1:4173')).toBe(
			'http://127.0.0.1:5173/app'
		);
	});
});

describe('browser embed creation', () => {
	test('creates exact desktop and mobile viewport specs', () => {
		expect(createBrowserEmbedSpec('desktop', 'http://localhost:5173/', [], 'desktop-1')).toEqual({
			id: 'desktop-1',
			device: 'desktop',
			url: 'http://localhost:5173/',
			x: 0,
			y: 0,
			width: 1440,
			height: 900
		});
		expect(createBrowserEmbedSpec('mobile', 'https://example.com/', [], 'mobile-1')).toMatchObject({
			id: 'mobile-1',
			device: 'mobile',
			width: 390,
			height: 844
		});
	});

	test('places appended nodes deterministically without overlap', () => {
		const occupied = [
			{ x: 0, y: 0, width: 1440, height: 900 },
			{ x: 1520, y: 0, width: 390, height: 844 }
		];
		expect(nextBrowserEmbedPosition(occupied)).toEqual({ x: 1990, y: 0 });
	});

	test('creates a complete Excalidraw 0.18.1 embeddable element', () => {
		const element = createExcalidrawEmbedElement(
			createBrowserEmbedSpec('mobile', 'http://localhost:5173', [], 'embed-1'),
			123,
			456,
			789
		);
		expect(element).toMatchObject({
			id: 'embed-1',
			type: 'embeddable',
			width: 390,
			height: 844,
			link: 'http://localhost:5173/',
			seed: 123,
			versionNonce: 456,
			updated: 789,
			version: 1,
			index: null,
			isDeleted: false,
			groupIds: [],
			frameId: null,
			boundElements: null,
			locked: false
		});
	});
});

describe('browser scene storage', () => {
	test('restores an existing active browser tab and falls back when it is gone', () => {
		const tabs = [{ id: 'first' }, { id: 'second' }];
		expect(restoreBrowserTabId(tabs, 'second')).toBe('second');
		expect(restoreBrowserTabId(tabs, 'missing')).toBe('first');
		expect(restoreBrowserTabId(tabs, null)).toBe('first');
	});

	test('restores the selected Browser or Excalidraw view', () => {
		expect(restoreBrowserView('excalidraw')).toBe('excalidraw');
		expect(restoreBrowserView('browser')).toBe('browser');
		expect(restoreBrowserView('unknown')).toBe('browser');
	});

	test('uses isolated versioned project keys', () => {
		expect(browserCanvasStorageKey('project-a')).toBe('hue:browser-canvas:v1:project-a');
		expect(browserCanvasStorageKey('project-b')).not.toBe(browserCanvasStorageKey('project-a'));
		expect(browserCanvasAddressKey('project-a')).toBe('hue:browser-canvas-address:v1:project-a');
		expect(legacyBrowserStorageKey('project-a')).toBe('hue:browser:project-a');
	});

	test('migrates bounded valid legacy tabs into desktop canvas embeds', () => {
		const migrated = migrateLegacyBrowserTabs(
			JSON.stringify([
				{ id: 'first', title: 'Local', url: 'http://localhost:5173/app' },
				{ id: 'invalid', title: 'Bad', url: 'javascript:alert(1)' },
				{ id: 'duplicate', title: 'Again', url: 'http://localhost:5173/app' },
				{ id: 'second', title: 'Docs', url: 'https://example.com/docs' }
			])
		);
		expect(migrated?.address).toBe('http://localhost:5173/app');
		const scene = parseStoredBrowserScene(migrated?.scene ?? null);
		expect(scene?.elements).toHaveLength(2);
		expect(scene?.elements.map((element) => element.link)).toEqual([
			'http://localhost:5173/app',
			'https://example.com/docs'
		]);
		expect(
			scene?.elements.every((element) => element.width === 1440 && element.height === 900)
		).toBe(true);
		expect(migrateLegacyBrowserTabs('{')).toBeNull();
		expect(migrateLegacyBrowserTabs(JSON.stringify([{ url: 'javascript:alert(1)' }]))).toBeNull();
	});

	test('restores only a bounded valid saved address', () => {
		expect(parseStoredBrowserAddress('http://localhost:5173/app')).toBe(
			'http://localhost:5173/app'
		);
		expect(parseStoredBrowserAddress('javascript:alert(1)')).toBe('');
		expect(parseStoredBrowserAddress('x'.repeat(4097))).toBe('');
	});

	test('round-trips bounded elements and minimal app state without files', () => {
		const raw = serializeBrowserScene(
			[
				{ id: 'shape', type: 'rectangle', x: 1, y: 2, width: 30, height: 40 },
				{
					id: 'embed',
					type: 'embeddable',
					x: 50,
					y: 60,
					width: 390,
					height: 844,
					link: 'http://localhost:5173/'
				},
				{
					id: 'unpersisted-image',
					type: 'image',
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					fileId: 'private-file'
				}
			],
			{
				scrollX: 10,
				scrollY: -20,
				zoom: { value: 0.5 },
				viewBackgroundColor: '#f8fafc',
				theme: 'dark',
				files: { private: { dataURL: 'data:secret' } }
			}
		);
		const restored = parseStoredBrowserScene(raw);
		expect(restored?.elements).toHaveLength(2);
		expect(restored?.appState).toEqual({
			scrollX: 10,
			scrollY: -20,
			zoom: { value: 0.5 },
			viewBackgroundColor: '#f8fafc',
			theme: 'dark'
		});
		expect(raw).not.toContain('data:secret');
	});

	test('rejects oversized, malformed, or untrusted stored scenes', () => {
		expect(parseStoredBrowserScene('{')).toBeNull();
		expect(parseStoredBrowserScene('x'.repeat(BROWSER_CANVAS_MAX_BYTES + 1))).toBeNull();
		expect(
			parseStoredBrowserScene(
				JSON.stringify({
					version: 1,
					elements: Array.from({ length: BROWSER_CANVAS_MAX_ELEMENTS + 1 }, (_, id) => ({
						id: String(id),
						type: 'rectangle'
					})),
					appState: {}
				})
			)
		).toBeNull();
		expect(
			parseStoredBrowserScene(
				JSON.stringify({
					version: 1,
					elements: [
						{ id: 'bad', type: 'embeddable', link: 'javascript:alert(1)' },
						{ id: 'unknown', type: 'made-up' }
					],
					appState: {}
				})
			)
		).toEqual({ version: 1, elements: [], appState: {} });
	});
});
