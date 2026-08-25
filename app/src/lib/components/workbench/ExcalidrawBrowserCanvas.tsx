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
};

export type BrowserCanvasController = {
	addEmbed: (device: BrowserDevice, url: string) => void;
	flush: () => Promise<void>;
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

	const flush = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = undefined;
		const scene = serializeBrowserScene(latestElements, latestAppState);
		saveChain = saveChain
			.then(() => options.onsave(scene))
			.catch(() => {
				options.onerror('Canvas could not be saved to HUE.');
			});
		return saveChain;
	};
	const scheduleSave = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 300);
	};
	const onChange = (
		elements: readonly ExcalidrawElement[],
		appState: AppState,
		_files: BinaryFiles
	) => {
		latestElements = elements;
		latestAppState = appState;
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
	const pageHide = () => void flush();
	window.addEventListener('pagehide', pageHide);
	document.addEventListener('visibilitychange', pageHide);
	render();

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
		destroy() {
			destroyed = true;
			void flush();
			themeObserver.disconnect();
			window.removeEventListener('pagehide', pageHide);
			document.removeEventListener('visibilitychange', pageHide);
			root.unmount();
		}
	};
}
