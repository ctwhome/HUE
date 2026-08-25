export const BROWSER_CANVAS_MAX_BYTES = 1_000_000;
export const BROWSER_CANVAS_MAX_ELEMENTS = 250;
const STORAGE_VERSION = 1 as const;
const ERROR_MESSAGE = 'Enter a valid http or https address';
const ELEMENT_TYPES = new Set([
	'rectangle',
	'diamond',
	'ellipse',
	'arrow',
	'line',
	'freedraw',
	'text',
	'frame',
	'magicframe',
	'embeddable',
	'iframe'
]);

export type BrowserDevice = 'desktop' | 'tablet' | 'mobile';
export type BrowserEmbedSpec = {
	id: string;
	device: BrowserDevice;
	url: string;
	x: number;
	y: number;
	width: number;
	height: number;
};
export type BrowserSceneElement = Record<string, unknown> & {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
};
export type BrowserSceneAppState = {
	scrollX?: number;
	scrollY?: number;
	zoom?: { value: number };
	viewBackgroundColor?: string;
	theme?: 'light' | 'dark';
};
export type StoredBrowserScene = {
	version: typeof STORAGE_VERSION;
	elements: BrowserSceneElement[];
	appState: BrowserSceneAppState;
};

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

export function normalizeBrowserUrl(value: string): string {
	try {
		if (!value || value !== value.trim() || /\s/.test(value)) throw new Error();
		if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new Error();
		const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			!url.hostname
		)
			throw new Error();
		return url.href;
	} catch {
		throw new Error(ERROR_MESSAGE);
	}
}

export function normalizeBrowserEmbedUrl(value: string, parentOrigin: string): string {
	const normalized = normalizeBrowserUrl(value);
	if (new URL(normalized).origin === new URL(parentOrigin).origin)
		throw new Error('Open HUE itself externally or use a different local origin');
	return normalized;
}

export const browserCanvasStorageKey = (projectId: string) =>
	`hue:browser-canvas:v${STORAGE_VERSION}:${projectId}`;
export const browserCanvasAddressKey = (projectId: string) =>
	`hue:browser-canvas-address:v${STORAGE_VERSION}:${projectId}`;
export const legacyBrowserStorageKey = (projectId: string) => `hue:browser:${projectId}`;

export function restoreBrowserTabId(
	tabs: ReadonlyArray<{ id: string }>,
	saved: string | null
): string {
	return (saved && tabs.some(({ id }) => id === saved) ? saved : tabs[0]?.id) ?? '';
}

export function restoreBrowserView(value: string | null): 'browser' | 'excalidraw' {
	return value === 'excalidraw' ? 'excalidraw' : 'browser';
}

export function parseStoredBrowserAddress(value: string | null): string {
	if (!value || value.length > 4096) return '';
	try {
		return normalizeBrowserUrl(value);
	} catch {
		return '';
	}
}

export function nextBrowserEmbedPosition(
	elements: ReadonlyArray<Pick<BrowserEmbedSpec, 'x' | 'y' | 'width' | 'height'>>
): { x: number; y: number } {
	if (!elements.length) return { x: 0, y: 0 };
	return {
		x: Math.max(...elements.map(({ x, width }) => x + width)) + 80,
		y: Math.min(...elements.map(({ y }) => y))
	};
}

export const browserDeviceLabel = (width: number, height: number) =>
	width === 390 && height === 844
		? 'Mobile'
		: width === 768 && height === 1024
			? 'Tablet'
			: 'Desktop';

export function createBrowserEmbedSpec(
	device: BrowserDevice,
	url: string,
	elements: ReadonlyArray<Pick<BrowserEmbedSpec, 'x' | 'y' | 'width' | 'height'>>,
	id: string = crypto.randomUUID()
): BrowserEmbedSpec {
	const size =
		device === 'desktop'
			? { width: 1440, height: 900 }
			: device === 'tablet'
				? { width: 768, height: 1024 }
				: { width: 390, height: 844 };
	return {
		id,
		device,
		url: normalizeBrowserUrl(url),
		...nextBrowserEmbedPosition(elements),
		...size
	};
}

const randomInteger = () => crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;

export function createExcalidrawEmbedElement(
	spec: BrowserEmbedSpec,
	seed = randomInteger(),
	versionNonce = randomInteger(),
	updated = Date.now()
) {
	return {
		id: spec.id,
		type: 'embeddable' as const,
		x: spec.x,
		y: spec.y,
		width: spec.width,
		height: spec.height,
		strokeColor: '#1b1b1f',
		backgroundColor: 'transparent',
		fillStyle: 'solid' as const,
		strokeWidth: 1,
		strokeStyle: 'solid' as const,
		roundness: null,
		roughness: 0,
		opacity: 100,
		angle: 0,
		seed,
		version: 1,
		versionNonce,
		index: null,
		isDeleted: false,
		groupIds: [],
		frameId: null,
		boundElements: null,
		updated,
		link: spec.url,
		locked: false
	};
}

export function migrateLegacyBrowserTabs(
	raw: string | null
): { address: string; scene: string } | null {
	if (!raw || byteLength(raw) > 100_000) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return null;
		const urls: string[] = [];
		for (const tab of parsed.slice(0, 25)) {
			if (!tab || typeof tab !== 'object' || typeof (tab as { url?: unknown }).url !== 'string')
				continue;
			try {
				const url = normalizeBrowserUrl((tab as { url: string }).url);
				if (!urls.includes(url)) urls.push(url);
			} catch {
				// Ignore malformed legacy entries while preserving the rest.
			}
		}
		if (!urls.length) return null;
		const elements: BrowserSceneElement[] = [];
		for (const url of urls) {
			const spec = createBrowserEmbedSpec('desktop', url, elements);
			elements.push(createExcalidrawEmbedElement(spec));
		}
		return { address: urls[0], scene: serializeBrowserScene(elements, {}) };
	} catch {
		return null;
	}
}

function sanitizeAppState(value: unknown): BrowserSceneAppState {
	if (!value || typeof value !== 'object') return {};
	const source = value as Record<string, unknown>;
	const result: BrowserSceneAppState = {};
	if (finite(source.scrollX)) result.scrollX = source.scrollX;
	if (finite(source.scrollY)) result.scrollY = source.scrollY;
	if (
		source.zoom &&
		typeof source.zoom === 'object' &&
		finite((source.zoom as { value?: unknown }).value) &&
		(source.zoom as { value: number }).value >= 0.1 &&
		(source.zoom as { value: number }).value <= 30
	)
		result.zoom = { value: (source.zoom as { value: number }).value };
	if (
		typeof source.viewBackgroundColor === 'string' &&
		/^#[0-9a-f]{6}$/i.test(source.viewBackgroundColor)
	)
		result.viewBackgroundColor = source.viewBackgroundColor;
	if (source.theme === 'light' || source.theme === 'dark') result.theme = source.theme;
	return result;
}

function sanitizeElement(value: unknown): BrowserSceneElement | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as Record<string, unknown>;
	if (
		typeof source.id !== 'string' ||
		!source.id ||
		typeof source.type !== 'string' ||
		!ELEMENT_TYPES.has(source.type) ||
		!finite(source.x) ||
		!finite(source.y) ||
		!finite(source.width) ||
		!finite(source.height) ||
		Math.abs(source.x) > 10_000_000 ||
		Math.abs(source.y) > 10_000_000 ||
		source.width < 0 ||
		source.height < 0 ||
		source.width > 10_000_000 ||
		source.height > 10_000_000
	)
		return null;
	const element = { ...source } as BrowserSceneElement;
	delete element.customData;
	if (source.type === 'embeddable' || source.type === 'iframe') {
		if (typeof source.link !== 'string') return null;
		try {
			element.link = normalizeBrowserUrl(source.link);
		} catch {
			return null;
		}
	}
	return element;
}

export function parseStoredBrowserScene(raw: string | null): StoredBrowserScene | null {
	if (!raw || byteLength(raw) > BROWSER_CANVAS_MAX_BYTES) return null;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (
			!parsed ||
			parsed.version !== STORAGE_VERSION ||
			!Array.isArray(parsed.elements) ||
			parsed.elements.length > BROWSER_CANVAS_MAX_ELEMENTS
		)
			return null;
		return {
			version: STORAGE_VERSION,
			elements: parsed.elements.map(sanitizeElement).filter((item) => item !== null),
			appState: sanitizeAppState(parsed.appState)
		};
	} catch {
		return null;
	}
}

export function serializeBrowserScene(elements: readonly unknown[], appState: unknown): string {
	const safeElements = elements
		.slice(0, BROWSER_CANVAS_MAX_ELEMENTS)
		.map(sanitizeElement)
		.filter((item) => item !== null);
	const scene: StoredBrowserScene = {
		version: STORAGE_VERSION,
		elements: safeElements,
		appState: sanitizeAppState(appState)
	};
	let serialized = JSON.stringify(scene);
	while (byteLength(serialized) > BROWSER_CANVAS_MAX_BYTES && scene.elements.length) {
		scene.elements.pop();
		serialized = JSON.stringify(scene);
	}
	return serialized;
}
