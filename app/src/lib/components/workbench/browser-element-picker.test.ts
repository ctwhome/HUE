import { expect, test } from 'bun:test';
import { formatBrowserElementContext } from './browser-element-picker';

test('formats bounded browser element metadata for the chat context', () => {
	const context = formatBrowserElementContext({
		pageUrl: 'http://127.0.0.1:44010/settings?token=secret',
		pageTitle: 'Settings',
		viewport: { width: 1280, height: 800 },
		devicePixelRatio: 2,
		element: {
			tag: 'button',
			text: 'Save changes',
			selector: '#save',
			path: 'main > form > button#save',
			bounds: { x: 1100.4, y: 720.6, width: 120, height: 40 },
			attributes: { id: 'save', type: 'submit', href: '/download?signature=secret' },
			computedStyle: { display: 'inline-flex', color: 'rgb(255, 255, 255)' },
			ancestry: ['main', 'form.settings']
		}
	});

	expect(context).toEqual({
		source: 'browser',
		label: 'Browser: button#save',
		content: expect.stringContaining('"pageTitle": "Settings"')
	});
	expect(context.content).toContain('"selector": "#save"');
	expect(context.content).toContain('"x": 1100');
	expect(context.content).toContain('http://127.0.0.1:44010/download');
	expect(context.content).not.toContain('secret');
});

test('removes URL secrets and keeps the serialized context valid and bounded', () => {
	const context = formatBrowserElementContext({
		pageUrl: 'http://user:password@127.0.0.1:44010/settings?token=secret#private',
		pageTitle: 'Settings',
		viewport: { width: 1280, height: 800 },
		devicePixelRatio: 1,
		element: {
			tag: '\u0000'.repeat(10_000),
			text: 'Download',
			selector: `main.${'x'.repeat(2_000)} > a`,
			path: `main.${'x'.repeat(2_000)} > a`,
			bounds: { x: 1, y: 2, width: 3, height: 4 },
			attributes: {
				href: '/download?signature=secret',
				...Object.fromEntries(
					Array.from({ length: 100 }, (_, index) => [`data-${index}`, '\u0000'.repeat(2_000)])
				)
			},
			computedStyle: Object.fromEntries(
				Array.from({ length: 100 }, (_, index) => [`style-${index}`, '\u0000'.repeat(10_000)])
			),
			ancestry: Array.from({ length: 20 }, () => 'x'.repeat(2_000))
		}
	});

	expect(context.content.length).toBeLessThanOrEqual(8_000);
	expect(() => JSON.parse(context.content)).not.toThrow();
	expect(context.content).not.toContain('secret');
	expect(context.content).not.toContain('password');
});
