import {
	attributeNames,
	formatBrowserElementContext,
	styleNames,
	type BrowserElementContext
} from './browser-element-picker';

export type NativeBrowserViewElement = HTMLElement & {
	loadURL: (url: string) => void;
	reload: () => void;
	goBack: () => void;
	goForward: () => void;
	executeJavascript: (source: string) => void;
	toggleDevTools: () => void;
	on: (name: string, listener: (event: CustomEvent) => void) => void;
	off: (name: string, listener: (event: CustomEvent) => void) => void;
};

type NativeRuntime = {
	__electrobunWebviewId?: unknown;
	customElements?: { get(name: string): unknown };
};

const record = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);
const strings = (value: unknown, keys: readonly string[]) => {
	if (!record(value)) return {};
	return Object.fromEntries(
		keys.flatMap((key) => (typeof value[key] === 'string' ? [[key, value[key]]] : []))
	);
};

export function nativeBrowserPreviewAvailable(scope: NativeRuntime) {
	return (
		typeof scope.__electrobunWebviewId === 'number' &&
		Boolean(scope.customElements?.get('electrobun-webview'))
	);
}

const cleanReloadScript = `void (async () => {
	try { localStorage.clear(); } catch {}
	try { sessionStorage.clear(); } catch {}
	const tasks = [];
	try { tasks.push(...(await caches.keys()).map((key) => caches.delete(key))); } catch {}
	try { tasks.push(...(await indexedDB.databases()).flatMap(({ name }) => name ? [new Promise((resolve) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = request.onerror = request.onblocked = resolve; })] : [])); } catch {}
	try { tasks.push(...(await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister())); } catch {}
	await Promise.allSettled(tasks);
	location.reload();
})()`;

export function cleanReloadNativeBrowser(frame: NativeBrowserViewElement) {
	frame.executeJavascript(cleanReloadScript);
}

function parseContext(value: unknown): BrowserElementContext | null {
	if (!record(value) || !record(value.viewport) || !record(value.element)) return null;
	const { element, viewport } = value;
	if (
		typeof value.pageUrl !== 'string' ||
		typeof value.pageTitle !== 'string' ||
		!finite(viewport.width) ||
		!finite(viewport.height) ||
		!finite(value.devicePixelRatio) ||
		typeof element.tag !== 'string' ||
		typeof element.text !== 'string' ||
		typeof element.selector !== 'string' ||
		typeof element.path !== 'string' ||
		!record(element.bounds) ||
		!finite(element.bounds.x) ||
		!finite(element.bounds.y) ||
		!finite(element.bounds.width) ||
		!finite(element.bounds.height) ||
		!Array.isArray(element.ancestry)
	)
		return null;
	return {
		pageUrl: value.pageUrl,
		pageTitle: value.pageTitle,
		viewport: { width: viewport.width, height: viewport.height },
		devicePixelRatio: value.devicePixelRatio,
		element: {
			tag: element.tag,
			text: element.text,
			selector: element.selector,
			path: element.path,
			bounds: {
				x: element.bounds.x,
				y: element.bounds.y,
				width: element.bounds.width,
				height: element.bounds.height
			},
			attributes: strings(element.attributes, attributeNames),
			computedStyle: strings(element.computedStyle, styleNames),
			ancestry: element.ancestry.filter((part): part is string => typeof part === 'string').slice(-4)
		}
	};
}

export function reviewContextFromNativeBrowserMessage(value: unknown) {
	if (!record(value) || value.type !== 'hue:browser:element-selected') return null;
	const context = parseContext(value.context);
	return context ? formatBrowserElementContext(context) : null;
}

const pickerScript = `(() => {
	window.__hueElementPickerCleanup?.();
	const attributeNames = ${JSON.stringify(attributeNames)};
	const styleNames = ${JSON.stringify(styleNames)};
	const bounded = (value, length) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, length);
	const selectorPart = (element) => {
		const tag = element.tagName.toLowerCase();
		if (element.id) return tag + '#' + CSS.escape(element.id);
		const classes = [...element.classList].slice(0, 2).map((name) => '.' + CSS.escape(name));
		let part = tag + classes.join('');
		const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.tagName === element.tagName) : [];
		if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')';
		return part;
	};
	const outline = document.createElement('div');
	Object.assign(outline.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #38bdf8', background: 'rgb(56 189 248 / 0.12)', boxSizing: 'border-box', display: 'none' });
	outline.dataset.hueElementPicker = '';
	document.documentElement.append(outline);
	const previousCursor = document.documentElement.style.cursor;
	document.documentElement.style.cursor = 'crosshair';
	let target = null;
	const blockedEvents = ['pointerdown', 'pointerup', 'auxclick', 'dblclick', 'mousedown', 'mouseup', 'contextmenu'];
	const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
	const highlight = (element) => {
		target = element;
		if (!target || target === outline) return;
		const rect = target.getBoundingClientRect();
		Object.assign(outline.style, { display: 'block', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
	};
	const move = (event) => highlight(document.elementFromPoint(event.clientX, event.clientY));
	const cleanup = () => {
		document.removeEventListener('pointermove', move, true);
		document.removeEventListener('click', select, true);
		for (const type of blockedEvents) document.removeEventListener(type, block, true);
		window.removeEventListener('keydown', keydown, true);
		document.documentElement.style.cursor = previousCursor;
		outline.remove();
		delete window.__hueElementPickerCleanup;
	};
	const send = (value) => window.__electrobunSendToHost?.(value);
	const select = (event) => {
		block(event);
		highlight(document.elementFromPoint(event.clientX, event.clientY));
		if (!target || target === outline) return;
		const parts = [];
		let current = target;
		while (current && parts.length < 5) { parts.unshift(selectorPart(current)); if (current.id) break; current = current.parentElement; }
		const ancestry = [];
		current = target.parentElement;
		while (current && ancestry.length < 4) { ancestry.unshift(bounded(selectorPart(current), 120)); current = current.parentElement; }
		const rect = target.getBoundingClientRect();
		const computed = getComputedStyle(target);
		const context = {
			pageUrl: location.href,
			pageTitle: bounded(document.title, 200),
			viewport: { width: innerWidth, height: innerHeight },
			devicePixelRatio,
			element: {
				tag: target.tagName.toLowerCase(), text: bounded(target.innerText || target.textContent, 400),
				selector: bounded(parts.join(' > '), 400), path: bounded(parts.join(' > '), 400),
				bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				attributes: Object.fromEntries(attributeNames.flatMap((name) => { const value = target.getAttribute(name); return value == null ? [] : [[name, bounded(value, 120)]]; })),
				computedStyle: Object.fromEntries(styleNames.map((name) => [name, bounded(computed.getPropertyValue(name), 80)])), ancestry
			}
		};
		cleanup();
		send({ type: 'hue:browser:element-selected', context });
	};
	const keydown = (event) => { if (event.key !== 'Escape') return; block(event); cleanup(); send({ type: 'hue:browser:element-cancelled' }); };
	window.__hueElementPickerCleanup = cleanup;
	document.addEventListener('pointermove', move, true);
	document.addEventListener('click', select, true);
	for (const type of blockedEvents) document.addEventListener(type, block, true);
	window.addEventListener('keydown', keydown, true);
})()`;

export function startNativeBrowserElementPicker(
	frame: NativeBrowserViewElement,
	onselect: (context: ReturnType<typeof formatBrowserElementContext>) => void,
	oncancel: () => void
) {
	const receive = (event: CustomEvent) => {
		const context = reviewContextFromNativeBrowserMessage(event.detail);
		if (context) {
			cleanup(false);
			onselect(context);
		} else if (record(event.detail) && event.detail.type === 'hue:browser:element-cancelled') {
			cleanup(false);
			oncancel();
		}
	};
	let active = true;
	const cleanup = (cancelChild = true) => {
		if (!active) return;
		active = false;
		try {
			frame.off('host-message', receive);
			if (cancelChild) frame.executeJavascript('window.__hueElementPickerCleanup?.()');
		} catch {
			// The native view may already be gone during tab or panel teardown.
		}
	};
	frame.on('host-message', receive);
	try {
		frame.executeJavascript(pickerScript);
	} catch (cause) {
		cleanup(false);
		throw cause;
	}
	return cleanup;
}
