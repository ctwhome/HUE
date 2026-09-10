import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type {
	ExcalidrawElement,
	ExcalidrawEmbeddableElement
} from '@excalidraw/excalidraw/element/types';
import {
	browserDeviceLabel,
	createBrowserEmbedSpec,
	createExcalidrawEmbedElement,
	normalizeBrowserEmbedUrl,
	parseStoredBrowserScene,
	serializeBrowserScene,
	type BrowserDevice
} from './browser-canvas';

type MountOptions = {
	initialScene: string;
	onsave: (scene: string) => Promise<void>;
	onready: (restoredUrl: string) => void;
	onerror: (message: string) => void;
	ondirtychange: (dirty: boolean) => void;
};

export type BrowserCanvasController = {
	addEmbed: (device: BrowserDevice, url: string) => void;
	flush: () => Promise<void>;
	exportScene: () => string;
	replaceScene: (scene: string) => void;
	discard: () => void;
	destroy: () => void;
};

const safeEmbedUrl = (link: string | null | undefined) => {
	try {
		return link ? normalizeBrowserEmbedUrl(link, window.location.origin) : null;
	} catch {
		return null;
	}
};

const embedTitle = (element: ExcalidrawEmbeddableElement, url: string) => {
	const device = browserDeviceLabel(element.width, element.height);
	return `${new URL(url).host} — ${device} (${element.width} × ${element.height})`;
};

export async function mountExcalidrawBrowserCanvas(
	target: HTMLElement,
	options: MountOptions
): Promise<BrowserCanvasController> {
	const [React, { createRoot }, excalidraw] = await Promise.all([
		import('react'),
		import('react-dom/client'),
		import('@excalidraw/excalidraw'),
		import('@excalidraw/excalidraw/index.css')
	]);
	const { CaptureUpdateAction, Excalidraw, restore } = excalidraw;
	const parsed = parseStoredBrowserScene(options.initialScene);
	// Excalidraw restore utilities own field-level scene repair; outer schema and links are bounded above.
	const restored = restore(
		parsed
			? {
					elements: parsed.elements as never,
					appState: parsed.appState as never,
					files: {}
				}
			: null,
		null,
		null
	);
	let api: ExcalidrawImperativeAPI | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let latestElements: readonly ExcalidrawElement[] = restored.elements;
	let latestAppState: Partial<AppState> = restored.appState;
	let destroyed = false;
	let saveChain = Promise.resolve();
	let acknowledgedScene = serializeBrowserScene(latestElements, latestAppState);
	let saveGeneration = 0;
	const reportDirty = () => {
		const scene = serializeBrowserScene(latestElements, latestAppState);
		options.ondirtychange(
			scene !== acknowledgedScene || JSON.parse(scene).elements.length !== latestElements.length
		);
	};

	const flush = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = undefined;
		const scene = serializeBrowserScene(latestElements, latestAppState);
		const generation = saveGeneration;
		const elementCount = latestElements.length;
		const request = saveChain
			.then(async () => {
				if (destroyed || generation !== saveGeneration) return;
				if (JSON.parse(scene).elements.length !== elementCount)
					throw new Error(
						'Canvas exceeds safe save limits. Export a recovery copy before simplifying it.'
					);
				if (scene === acknowledgedScene) return;
				await options.onsave(scene);
				if (generation !== saveGeneration) return;
				acknowledgedScene = scene;
				reportDirty();
			})
			.catch((cause) => {
				options.onerror(
					cause instanceof Error ? cause.message : 'Canvas could not be saved to HUE.'
				);
				throw cause;
			});
		saveChain = request.catch(() => undefined);
		return request;
	};
	const scheduleSave = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void flush().catch(() => undefined), 300);
	};
	const onChange = (
		elements: readonly ExcalidrawElement[],
		appState: AppState,
		_files: BinaryFiles
	) => {
		latestElements = elements;
		latestAppState = appState;
		reportDirty();
		scheduleSave();
	};
	const renderEmbeddable = (element: ExcalidrawEmbeddableElement) => {
		const url = safeEmbedUrl(element.link);
		if (!url) return null;
		const title = embedTitle(element, url);
		return React.createElement(
			'div',
			{ className: 'browser-embed' },
			React.createElement('iframe', {
				src: url,
				title,
				width: element.width,
				height: element.height,
				sandbox: 'allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
				referrerPolicy: 'no-referrer'
			}),
			React.createElement(
				'a',
				{
					className: 'browser-embed-external',
					href: url,
					target: '_blank',
					rel: 'noopener noreferrer',
					'aria-label': `Open ${title} externally`,
					title: 'Open externally'
				},
				'↗'
			)
		);
	};
	const getTheme = (): 'light' | 'dark' => {
		const theme = document.documentElement.dataset.theme;
		if (theme === 'light') return 'light';
		if (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches) return 'light';
		return 'dark';
	};
	const render = () => {
		if (destroyed) return;
		root.render(
			React.createElement(Excalidraw, {
				initialData: { elements: restored.elements, appState: restored.appState, files: {} },
				theme: getTheme(),
				autoFocus: false,
				detectScroll: true,
				UIOptions: { tools: { image: false } },
				validateEmbeddable: (link: string) => safeEmbedUrl(link) !== null,
				renderEmbeddable,
				onChange,
				excalidrawAPI: (nextApi: ExcalidrawImperativeAPI) => {
					api = nextApi;
					const restoredUrl = [...nextApi.getSceneElements()]
						.reverse()
						.map((element) => safeEmbedUrl(element.link))
						.find((url): url is string => Boolean(url));
					options.onready(restoredUrl ?? '');
				}
			})
		);
	};
	const root = createRoot(target);
	const themeObserver = new MutationObserver(render);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme']
	});
	// Best-effort early flush only. Page termination cannot guarantee delivery of a large scene.
	const pageHide = () => {
		if (document.visibilityState === 'hidden') void flush().catch(() => undefined);
	};
	window.addEventListener('pagehide', pageHide);
	document.addEventListener('visibilitychange', pageHide);
	render();
	const replaceScene = (scene: string) => {
		if (saveTimer) clearTimeout(saveTimer);
		saveGeneration += 1;
		const parsed = parseStoredBrowserScene(scene);
		const next = restore(
			parsed
				? { elements: parsed.elements as never, appState: parsed.appState as never, files: {} }
				: null,
			null,
			null
		);
		latestElements = next.elements;
		latestAppState = next.appState;
		acknowledgedScene = serializeBrowserScene(latestElements, latestAppState);
		api?.updateScene({
			elements: next.elements,
			appState: next.appState,
			captureUpdate: CaptureUpdateAction.NEVER
		});
		reportDirty();
	};

	return {
		addEmbed(device, url) {
			if (!api) throw new Error('Canvas is still loading.');
			const safeUrl = normalizeBrowserEmbedUrl(url, window.location.origin);
			const spec = createBrowserEmbedSpec(device, safeUrl, api.getSceneElements());
			const created = createExcalidrawEmbedElement(spec) as ExcalidrawElement;
			api.updateScene({
				elements: [...api.getSceneElements(), created],
				appState: { selectedElementIds: { [created.id]: true } },
				captureUpdate: CaptureUpdateAction.IMMEDIATELY
			});
			api.scrollToContent(created, {
				fitToViewport: true,
				viewportZoomFactor: 0.75,
				animate: true
			});
		},
		flush,
		exportScene: () =>
			JSON.stringify({
				type: 'excalidraw',
				version: 2,
				source: 'HUE',
				elements: latestElements,
				appState: latestAppState,
				files: {}
			}),
		replaceScene,
		discard: () => replaceScene(acknowledgedScene),
		destroy() {
			destroyed = true;
			if (saveTimer) clearTimeout(saveTimer);
			saveGeneration += 1;
			themeObserver.disconnect();
			window.removeEventListener('pagehide', pageHide);
			document.removeEventListener('visibilitychange', pageHide);
			root.unmount();
		}
	};
}
