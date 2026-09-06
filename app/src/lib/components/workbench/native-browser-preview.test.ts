import { expect, test } from 'bun:test';
import {
	cleanReloadNativeBrowser,
	nativeBrowserPreviewAvailable,
	reviewContextFromNativeBrowserMessage,
	startNativeBrowserElementPicker,
	type NativeBrowserViewElement
} from './native-browser-preview';

test('native clean reload clears site data before reloading', () => {
	let source = '';
	const frame = {
		executeJavascript(value: string) {
			source = value;
		}
	} as unknown as NativeBrowserViewElement;

	cleanReloadNativeBrowser(frame);

	for (const operation of [
		'localStorage.clear()',
		'sessionStorage.clear()',
		'caches.delete',
		'indexedDB.deleteDatabase',
		'unregister()',
		'location.reload()'
	])
		expect(source).toContain(operation);
});

test('native previews require an Electrobun host and registered webview element', () => {
	expect(
		nativeBrowserPreviewAvailable({
			__electrobunWebviewId: 7,
			customElements: { get: () => class {} }
		})
	).toBe(true);
	expect(
		nativeBrowserPreviewAvailable({
			__electrobunWebviewId: 7,
			customElements: { get: () => undefined }
		})
	).toBe(false);
});

test('native picker accepts bounded metadata as untrusted browser context', () => {
	const context = reviewContextFromNativeBrowserMessage({
		type: 'hue:browser:element-selected',
		context: {
			pageUrl: 'http://127.0.0.1:5173/account?token=secret',
			pageTitle: 'Account',
			viewport: { width: 1280, height: 800 },
			devicePixelRatio: 2,
			element: {
				tag: 'button',
				text: 'Save',
				selector: 'main > button#save',
				path: 'main > button#save',
				bounds: { x: 10, y: 20, width: 80, height: 40 },
				attributes: { id: 'save' },
				computedStyle: { display: 'inline-flex' },
				ancestry: ['main']
			}
		}
	});

	expect(context?.label).toBe('Browser: button#save');
	expect(context?.content).not.toContain('secret');
});

test('native picker rejects malformed host messages', () => {
	expect(reviewContextFromNativeBrowserMessage({ type: 'other' })).toBeNull();
	expect(
		reviewContextFromNativeBrowserMessage({
			type: 'hue:browser:element-selected',
			context: { pageUrl: 'https://example.com', element: { tag: 'button' } }
		})
	).toBeNull();
});

test('native picker cleanup tolerates an already removed webview', () => {
	let executions = 0;
	const frame = {
		on() {},
		off() {},
		executeJavascript() {
			if (executions++) throw new Error('view removed');
		}
	} as unknown as NativeBrowserViewElement;
	const stop = startNativeBrowserElementPicker(frame, () => {}, () => {});

	expect(stop).not.toThrow();
});
