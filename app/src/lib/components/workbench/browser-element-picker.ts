import { reviewContextLimits, type ReviewContextSeed } from '$lib/message-content';

type Rect = { x: number; y: number; width: number; height: number };
export type BrowserElementContext = {
	pageUrl: string;
	pageTitle: string;
	viewport: { width: number; height: number };
	devicePixelRatio: number;
	element: {
		tag: string;
		text: string;
		selector: string;
		path: string;
		bounds: Rect;
		attributes: Record<string, string>;
		computedStyle: Record<string, string>;
		ancestry: string[];
	};
};

const attributeNames = [
	'id',
	'class',
	'name',
	'type',
	'href',
	'src',
	'alt',
	'title',
	'role',
	'placeholder',
	'aria-label',
	'data-testid'
];
const styleNames = [
	'display',
	'position',
	'color',
	'background-color',
	'font-family',
	'font-size',
	'font-weight',
	'line-height',
	'margin',
	'padding',
	'border',
	'border-radius',
	'width',
	'height',
	'opacity',
	'z-index',
	'align-items',
	'justify-content',
	'gap',
	'text-align'
];
const bounded = (value: string, length: number) =>
	value.replace(/\s+/g, ' ').trim().slice(0, length);
function sanitizedUrl(value: string, base?: string) {
	try {
		const url = new URL(value, base);
		if (!['http:', 'https:'].includes(url.protocol)) return '';
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return bounded(url.href, 1_000);
	} catch {
		return '';
	}
}
const roundedRect = ({ x, y, width, height }: DOMRect): Rect => ({
	x: Math.round(x),
	y: Math.round(y),
	width: Math.round(width),
	height: Math.round(height)
});

function selectorPart(element: Element) {
	const tag = element.tagName.toLowerCase();
	if (element.id) return `${tag}#${CSS.escape(element.id)}`;
	const classes = [...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`);
	let part = `${tag}${classes.join('')}`;
	const siblings = element.parentElement
		? [...element.parentElement.children].filter((sibling) => sibling.tagName === element.tagName)
		: [];
	if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(element) + 1})`;
	return part;
}

function elementContext(element: Element, view: Window): BrowserElementContext {
	const parts: string[] = [];
	let current: Element | null = element;
	while (current && parts.length < 5) {
		parts.unshift(selectorPart(current));
		if (current.id) break;
		current = current.parentElement;
	}
	const ancestry: string[] = [];
	current = element.parentElement;
	while (current && ancestry.length < 4) {
		ancestry.unshift(bounded(selectorPart(current), 120));
		current = current.parentElement;
	}
	const attributes = Object.fromEntries(
		attributeNames.flatMap((name) => {
			const value = element.getAttribute(name);
			if (value == null) return [];
			const captured =
				name === 'href' || name === 'src'
					? sanitizedUrl(value, view.location.href)
					: bounded(value, 120);
			return captured ? [[name, captured]] : [];
		})
	);
	const computed = view.getComputedStyle(element);
	return {
		pageUrl: sanitizedUrl(view.location.href),
		pageTitle: bounded(view.document.title, 200),
		viewport: { width: view.innerWidth, height: view.innerHeight },
		devicePixelRatio: view.devicePixelRatio,
		element: {
			tag: bounded(element.tagName.toLowerCase(), 100),
			text: bounded((element as HTMLElement).innerText || element.textContent || '', 400),
			selector: bounded(parts.join(' > '), 400),
			path: bounded(parts.join(' > '), 400),
			bounds: roundedRect(element.getBoundingClientRect()),
			attributes,
			computedStyle: Object.fromEntries(
				styleNames.map((name) => [name, bounded(computed.getPropertyValue(name), 80)])
			),
			ancestry
		}
	};
}

export function formatBrowserElementContext(context: BrowserElementContext): ReviewContextSeed {
	const { element } = context;
	const payload = {
		...context,
		pageUrl: sanitizedUrl(context.pageUrl),
		pageTitle: bounded(context.pageTitle, 200),
		element: {
			...element,
			tag: bounded(element.tag, 100),
			text: bounded(element.text, 400),
			selector: bounded(element.selector, 400),
			path: bounded(element.path, 400),
			attributes: Object.fromEntries(
				Object.entries(element.attributes).flatMap(([name, value]) => {
					const captured =
						name === 'href' || name === 'src'
							? sanitizedUrl(value, context.pageUrl)
							: bounded(value, 120);
					return captured ? [[name, captured]] : [];
				})
			),
			computedStyle: Object.fromEntries(
				Object.entries(element.computedStyle).map(([name, value]) => [name, bounded(value, 80)])
			),
			ancestry: element.ancestry.slice(-4).map((part) => bounded(part, 120)),
			bounds: Object.fromEntries(
				Object.entries(element.bounds).map(([key, value]) => [key, Math.round(value)])
			)
		}
	};
	let serialized = payload;
	let content = JSON.stringify(serialized, null, 2);
	if (content.length > reviewContextLimits.maxContentChars) {
		serialized = { ...payload, element: { ...payload.element, computedStyle: {} } };
		content = JSON.stringify(serialized, null, 2);
	}
	if (content.length > reviewContextLimits.maxContentChars) {
		content = JSON.stringify(
			{
				pageUrl: payload.pageUrl,
				pageTitle: bounded(payload.pageTitle, 100),
				viewport: payload.viewport,
				devicePixelRatio: payload.devicePixelRatio,
				element: {
					tag: payload.element.tag,
					text: bounded(payload.element.text, 200),
					selector: bounded(payload.element.selector, 300),
					bounds: payload.element.bounds
				}
			},
			null,
			2
		);
	}
	if (content.length > reviewContextLimits.maxContentChars) {
		content = JSON.stringify({
			pageUrl: bounded(payload.pageUrl, 500),
			element: {
				tag: bounded(payload.element.tag, 100),
				text: bounded(payload.element.text, 100),
				selector: bounded(payload.element.selector, 300)
			}
		});
	}
	return {
		source: 'browser',
		label: bounded(
			`Browser: ${element.tag}${element.attributes.id ? `#${element.attributes.id}` : ''}`,
			200
		),
		content
	};
}

export function startBrowserElementPicker(
	frame: HTMLIFrameElement,
	onselect: (context: ReviewContextSeed) => void,
	oncancel: () => void
) {
	let document: Document;
	let view: Window;
	try {
		if (!frame.contentDocument || !frame.contentWindow) throw new Error();
		document = frame.contentDocument;
		view = frame.contentWindow;
		void document.documentElement.tagName;
	} catch {
		throw new Error('Element selection is available only for same-origin previews.');
	}
	const previousCursor = document.documentElement.style.cursor;
	const hostWindow = frame.ownerDocument.defaultView;
	const outline = document.createElement('div');
	Object.assign(outline.style, {
		position: 'fixed',
		zIndex: '2147483647',
		pointerEvents: 'none',
		border: '2px solid #38bdf8',
		background: 'rgb(56 189 248 / 0.12)',
		boxSizing: 'border-box',
		display: 'none'
	});
	outline.setAttribute('data-hue-element-picker', '');
	document.documentElement.append(outline);
	document.documentElement.style.cursor = 'crosshair';
	let target: Element | null = null;
	let active = true;
	const blockedEvents = [
		'pointerdown',
		'pointerup',
		'auxclick',
		'dblclick',
		'mousedown',
		'mouseup',
		'contextmenu'
	];
	const block = (event: Event) => {
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	const highlight = (element: Element | null) => {
		target = element;
		if (!target || target === outline) return;
		const rect = target.getBoundingClientRect();
		Object.assign(outline.style, {
			display: 'block',
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`
		});
	};
	const move = (event: PointerEvent) =>
		highlight(document.elementFromPoint(event.clientX, event.clientY));
	const focus = (event: FocusEvent) =>
		highlight(event.target instanceof Element ? event.target : null);
	const cleanup = () => {
		if (!active) return;
		active = false;
		document.removeEventListener('pointermove', move, true);
		document.removeEventListener('focusin', focus, true);
		document.removeEventListener('click', select, true);
		for (const type of blockedEvents) document.removeEventListener(type, block, true);
		view.removeEventListener('keydown', keydown, true);
		hostWindow?.removeEventListener('keydown', hostKeydown, true);
		document.documentElement.style.cursor = previousCursor;
		outline.remove();
	};
	const selectTarget = () => {
		if (!target || target === outline) return;
		const context = formatBrowserElementContext(elementContext(target, view));
		cleanup();
		onselect(context);
	};
	const select = (event: MouseEvent) => {
		block(event);
		highlight(
			event.detail === 0
				? document.activeElement
				: document.elementFromPoint(event.clientX, event.clientY)
		);
		selectTarget();
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && target) {
			block(event);
			selectTarget();
			return;
		}
		if (event.key !== 'Escape') return;
		block(event);
		cleanup();
		oncancel();
	};
	const hostKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		block(event);
		cleanup();
		oncancel();
	};
	document.addEventListener('pointermove', move, true);
	document.addEventListener('focusin', focus, true);
	document.addEventListener('click', select, true);
	for (const type of blockedEvents) document.addEventListener(type, block, true);
	view.addEventListener('keydown', keydown, true);
	hostWindow?.addEventListener('keydown', hostKeydown, true);
	view.focus();
	return cleanup;
}
