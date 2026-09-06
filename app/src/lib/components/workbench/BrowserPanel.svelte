<script lang="ts">
	import { onMount } from 'svelte';
	import ArrowLeft from '~icons/lucide/arrow-left';
	import ArrowRight from '~icons/lucide/arrow-right';
	import Eraser from '~icons/lucide/eraser';
	import EyeOff from '~icons/lucide/eye-off';
	import ExternalLink from '~icons/lucide/external-link';
	import Globe from '~icons/lucide/globe';
	import Monitor from '~icons/lucide/monitor';
	import Plus from '~icons/lucide/plus';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import ScanSearch from '~icons/lucide/scan-search';
	import Smartphone from '~icons/lucide/smartphone';
	import SquareTerminal from '~icons/lucide/square-terminal';
	import Tablet from '~icons/lucide/tablet';
	import X from '~icons/lucide/x';
	import ZoomIn from '~icons/lucide/zoom-in';
	import ZoomOut from '~icons/lucide/zoom-out';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import type { ReviewContextSeed } from '$lib/message-content';
	import { api } from './api';
	import {
		browserDeviceSizes,
		normalizeBrowserUrl,
		restoreHiddenPorts,
		restoreBrowserTabId,
		type BrowserDevice
	} from './browser-canvas';
	import { startBrowserElementPicker } from './browser-element-picker';
	import {
		cleanReloadNativeBrowser,
		nativeBrowserPreviewAvailable,
		startNativeBrowserElementPicker,
		type NativeBrowserViewElement
	} from './native-browser-preview';

	type BrowserTab = {
		id: string;
		title: string;
		url: string;
		draft: string;
		source: string;
		reload: number;
		mounted: boolean;
	};
	let {
		projectId,
		active = true,
		onpreviewchange,
		onreviewcontext
	}: {
		projectId: string;
		active?: boolean;
		onpreviewchange: (url: string) => void;
		onreviewcontext?: (context: ReviewContextSeed) => void;
	} = $props();
	let browserTabs = $state<BrowserTab[]>([]);
	let activeBrowserTabId = $state('');
	let browserError = $state('');
	let browserDevice = $state<BrowserDevice>('desktop');
	let browserZoom = $state(1);
	let selectingElement = $state(false);
	let nativePreview = $state(false);
	type DevServer = {
		port: number;
		url: string;
		pid: number;
		process: string;
		folder: string;
		canStop: boolean;
	};
	let devServers = $state<DevServer[]>([]);
	let discoveringServers = $state(false);
	let discoveryStarted = $state(false);
	let stoppingPid = $state<number>();
	let hiddenPorts = $state<number[]>([]);
	let elementPickerButton: HTMLButtonElement;
	let stopElementPicker: (() => void) | null = null;
	type BrowserFrame = HTMLIFrameElement | NativeBrowserViewElement;
	const browserFrames = new Map<string, BrowserFrame>();
	let currentBrowserTab = $derived(activeBrowserTab());
	let browserSize = $derived(browserDeviceSizes[browserDevice]);
	let visibleDevServers = $derived(devServers.filter(({ port }) => !hiddenPorts.includes(port)));
	let hiddenServerCount = $derived(
		hiddenPorts.filter((port) => devServers.some((server) => server.port === port)).length
	);
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	const storageKey = () => `hue:browser:${projectId}`;
	const activeStorageKey = () => `${storageKey()}:active`;
	const hiddenPortsStorageKey = 'hue:browser:hidden-ports';
	const newBrowserTab = (): BrowserTab => ({
		id: crypto.randomUUID(),
		title: 'New tab',
		url: '',
		draft: '',
		source: '',
		reload: 0,
		mounted: true
	});
	function restoreBrowserTabs() {
		try {
			const saved = JSON.parse(localStorage.getItem(storageKey()) ?? '[]') as BrowserTab[];
			browserTabs = saved.slice(0, 50).flatMap((tab) => {
				if (
					typeof tab.id !== 'string' ||
					typeof tab.url !== 'string' ||
					typeof tab.title !== 'string'
				)
					return [];
				try {
					const url = tab.url ? normalizeBrowserUrl(tab.url) : '';
					return [{ ...tab, url, draft: url, source: url, reload: 0, mounted: false }];
				} catch {
					return [];
				}
			});
		} catch {
			browserTabs = [];
		}
		if (!browserTabs.length) browserTabs = [newBrowserTab()];
		activeBrowserTabId = restoreBrowserTabId(browserTabs, localStorage.getItem(activeStorageKey()));
		browserTabs = browserTabs.map((tab) =>
			tab.id === activeBrowserTabId ? { ...tab, mounted: true } : tab
		);
		onpreviewchange(activeBrowserTab()?.url ?? '');
	}
	function saveBrowserTabs() {
		try {
			localStorage.setItem(
				storageKey(),
				JSON.stringify(browserTabs.map(({ id, title, url }) => ({ id, title, url })))
			);
			localStorage.setItem(activeStorageKey(), activeBrowserTabId);
		} catch {
			browserError = 'Browser tabs could not be saved in this browser.';
		}
	}
	function activeBrowserTab() {
		return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? browserTabs[0];
	}
	function updateBrowserDraft(event: Event) {
		const draft = (event.currentTarget as HTMLInputElement).value;
		browserTabs = browserTabs.map((tab) =>
			tab.id === activeBrowserTabId ? { ...tab, draft } : tab
		);
	}
	function openBrowserUrl(value: string) {
		cancelElementSelection();
		const tab = activeBrowserTab();
		if (!tab) return;
		let url: URL;
		try {
			url = new URL(normalizeBrowserUrl(value));
		} catch {
			browserError = 'Enter a valid http or https address';
			return;
		}
		browserTabs = browserTabs.map((item) =>
			item.id === tab.id
				? {
						...item,
						title: url.hostname || 'Browser',
						url: url.href,
						draft: url.href,
						source: url.href,
						reload: item.reload + 1,
						mounted: true
					}
				: item
		);
		browserError = '';
		saveBrowserTabs();
		onpreviewchange(url.href);
	}
	function navigateBrowser(event: SubmitEvent) {
		event.preventDefault();
		const tab = activeBrowserTab();
		if (tab) openBrowserUrl(tab.draft);
	}
	async function discoverServers() {
		if (discoveringServers) return;
		discoveryStarted = true;
		discoveringServers = true;
		try {
			devServers = (await api<{ servers: DevServer[] }>('/api/dev-servers')).servers;
		} catch {
			devServers = [];
		} finally {
			discoveringServers = false;
		}
	}
	async function stopServer(server: DevServer) {
		if (!server.canStop || !confirm(`Stop ${server.process} (PID ${server.pid}) on port ${server.port}?`))
			return;
		stoppingPid = server.pid;
		try {
			await api('/api/dev-servers', {
				method: 'POST',
				body: JSON.stringify({ pid: server.pid, port: server.port })
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			await discoverServers();
		} catch (cause) {
			browserError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			stoppingPid = undefined;
		}
	}
	function saveHiddenPorts() {
		try {
			localStorage.setItem(hiddenPortsStorageKey, JSON.stringify(hiddenPorts));
		} catch {
			browserError = 'Hidden servers could not be saved in this browser.';
		}
	}
	function hideServer(port: number) {
		hiddenPorts = [...hiddenPorts, port];
		saveHiddenPorts();
	}
	function showHiddenServers() {
		hiddenPorts = [];
		saveHiddenPorts();
	}
	function addBrowserTab() {
		cancelElementSelection();
		const tab = newBrowserTab();
		browserTabs = [...browserTabs, tab];
		activeBrowserTabId = tab.id;
		browserError = '';
		saveBrowserTabs();
		onpreviewchange('');
	}
	function closeBrowserTab(event: MouseEvent | KeyboardEvent, id: string) {
		event.stopPropagation();
		cancelElementSelection();
		const closingActiveTab = activeBrowserTabId === id;
		const remaining = browserTabs.filter((tab) => tab.id !== id);
		browserTabs = remaining.length ? remaining : [newBrowserTab()];
		if (closingActiveTab) {
			activeBrowserTabId = browserTabs[0].id;
			browserTabs = browserTabs.map((tab, index) =>
				index === 0 ? { ...tab, mounted: true } : tab
			);
		}
		saveBrowserTabs();
		onpreviewchange(activeBrowserTab()?.url ?? '');
	}
	function selectBrowserTab(tab: BrowserTab) {
		cancelElementSelection();
		activeBrowserTabId = tab.id;
		if (!tab.mounted)
			browserTabs = browserTabs.map((item) =>
				item.id === tab.id ? { ...item, mounted: true } : item
			);
		saveBrowserTabs();
		onpreviewchange(tab.url);
	}
	function reloadBrowser() {
		cancelElementSelection();
		if (!currentBrowserTab?.url) return;
		browserTabs = browserTabs.map((tab) =>
			tab.id === activeBrowserTabId ? { ...tab, source: tab.url, reload: tab.reload + 1 } : tab
		);
	}
	function cleanReloadBrowser() {
		cancelElementSelection();
		const frame = browserFrames.get(activeBrowserTabId);
		if (!frame || !currentBrowserTab?.url) return;
		if (!isNativeFrame(frame)) {
			browserError = 'Clean reload is available in the HUE desktop app.';
			return;
		}
		try {
			cleanReloadNativeBrowser(frame);
			browserError = '';
		} catch (cause) {
			browserError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function syncBrowserNavigation(tabId: string, value: string, title?: string) {
		const tab = browserTabs.find(({ id }) => id === tabId);
		if (!tab) return;
		let url: URL;
		try {
			url = new URL(normalizeBrowserUrl(value));
		} catch {
			return;
		}
		browserTabs = browserTabs.map((item) =>
			item.id === tabId
				? { ...item, title: title || url.hostname || 'Browser', url: url.href, draft: url.href }
				: item
		);
		saveBrowserTabs();
		if (tabId === activeBrowserTabId) onpreviewchange(url.href);
	}
	const isNativeFrame = (frame: BrowserFrame): frame is NativeBrowserViewElement =>
		frame.tagName === 'ELECTROBUN-WEBVIEW';
	function trackBrowserFrame(node: BrowserFrame, tabId: string) {
		browserFrames.set(tabId, node);
		const navigation = (event: CustomEvent) => {
			if (typeof event.detail === 'string') syncBrowserNavigation(tabId, event.detail);
		};
		if (isNativeFrame(node)) node.on('did-navigate', navigation);
		return {
			destroy() {
				if (isNativeFrame(node)) node.off('did-navigate', navigation);
				if (browserFrames.get(tabId) === node) browserFrames.delete(tabId);
			}
		};
	}
	function syncBrowserFrame(event: Event, tabId: string) {
		if (tabId === activeBrowserTabId) cancelElementSelection();
		const frame = event.currentTarget as HTMLIFrameElement;
		if (browserFrames.get(tabId) !== frame) return;
		try {
			if (frame.contentWindow)
				syncBrowserNavigation(
					tabId,
					frame.contentWindow.location.href,
					frame.contentDocument?.title
				);
		} catch {
			// Cross-origin previews can report navigation through hue:browser:navigation.
		}
	}
	function navigateBrowserHistory(direction: 'back' | 'forward') {
		cancelElementSelection();
		const frame = browserFrames.get(activeBrowserTabId);
		if (!frame || !currentBrowserTab?.url) return;
		if (isNativeFrame(frame)) {
			frame[direction === 'back' ? 'goBack' : 'goForward']();
			return;
		}
		const frameWindow = frame.contentWindow;
		if (!frameWindow) return;
		if (new URL(currentBrowserTab.url).origin === window.location.origin) {
			frameWindow.history[direction]();
			return;
		}
		frameWindow.postMessage(
			{ type: 'hue:browser:history', direction },
			new URL(currentBrowserTab.url).origin
		);
	}
	function cancelElementSelection() {
		stopElementPicker?.();
		stopElementPicker = null;
		selectingElement = false;
	}
	$effect(() => {
		if (!active) cancelElementSelection();
	});
	$effect(() => {
		if (active && currentBrowserTab && !currentBrowserTab.url && !discoveryStarted) {
			void discoverServers();
		}
	});
	function toggleElementSelection(event: MouseEvent) {
		elementPickerButton = event.currentTarget as HTMLButtonElement;
		if (selectingElement) return cancelElementSelection();
		const frame = browserFrames.get(activeBrowserTabId);
		if (!frame || !onreviewcontext) return;
		try {
			selectingElement = true;
			browserError = '';
			const select = (context: ReviewContextSeed) => {
				stopElementPicker = null;
				selectingElement = false;
				onreviewcontext(context);
			};
			const cancel = () => {
				stopElementPicker = null;
				selectingElement = false;
				queueMicrotask(() => elementPickerButton?.focus());
			};
			stopElementPicker = isNativeFrame(frame)
				? startNativeBrowserElementPicker(frame, select, cancel)
				: startBrowserElementPicker(frame, select, cancel);
		} catch (cause) {
			selectingElement = false;
			browserError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function toggleDeveloperTools() {
		const frame = browserFrames.get(activeBrowserTabId);
		if (!frame || !isNativeFrame(frame)) return;
		try {
			frame.toggleDevTools();
			browserError = '';
		} catch (cause) {
			browserError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	onMount(() => {
		nativePreview = nativeBrowserPreviewAvailable(window);
		hiddenPorts = restoreHiddenPorts(localStorage.getItem(hiddenPortsStorageKey));
		restoreBrowserTabs();
		const receiveNavigation = (event: MessageEvent) => {
			if (event.data?.type !== 'hue:browser:navigation') return;
			const tabId = [...browserFrames].find(
				([, frame]) => !isNativeFrame(frame) && event.source === frame.contentWindow
			)?.[0];
			if (!tabId) return;
			if (typeof event.data.url !== 'string') return;
			try {
				if (new URL(event.data.url).origin !== event.origin) return;
			} catch {
				return;
			}
			syncBrowserNavigation(
				tabId,
				event.data.url,
				typeof event.data.title === 'string' ? event.data.title : undefined
			);
		};
		window.addEventListener('message', receiveNavigation);
		return () => {
			cancelElementSelection();
			window.removeEventListener('message', receiveNavigation);
		};
	});
</script>

<article class={`${panel} browser-panel`} aria-label="Project browser">
	<header class="grid border-b border-border bg-muted/40 p-0">
		<div
			class="browser-tabs flex min-w-0 overflow-x-auto border-b border-border"
			role="group"
			aria-label="Browser tabs"
		>
			{#each browserTabs as tab}
				<div
					class="browser-tab flex min-h-9 min-w-24 flex-[0_1_150px] items-center border-r border-border bg-background text-xs text-muted-foreground"
					class:active={tab.id === activeBrowserTabId}
				>
					<button
						class="h-full min-w-0 flex-1 overflow-hidden px-2 text-left text-ellipsis whitespace-nowrap"
						aria-pressed={tab.id === activeBrowserTabId}
						title={`Open ${tab.title}`}
						onclick={() => selectBrowserTab(tab)}>{tab.title}</button
					>
					<button
						class="grid h-full w-7 place-items-center"
						aria-label={`Close ${tab.title}`}
						title={`Close ${tab.title}`}
						onclick={(event) => closeBrowserTab(event, tab.id)}
						><X width={12} height={12} aria-hidden="true" /></button
					>
				</div>
			{/each}
			<Button
				variant="ghost"
				size="icon"
				class="add-tab size-9"
				title="New browser tab"
				aria-label="New browser tab"
				onclick={addBrowserTab}><Plus width={16} height={16} aria-hidden="true" /></Button
			>
		</div>
		<form
			class="browser-address grid items-center gap-1.5 overflow-x-auto p-1.5"
			style="grid-template-columns: auto auto auto auto minmax(8rem, 1fr) auto auto auto auto auto auto"
			onsubmit={navigateBrowser}
		>
			<Button
				size="icon"
				variant="ghost"
				disabled={!currentBrowserTab?.url}
				aria-label="Back"
				title="Back"
				onclick={() => navigateBrowserHistory('back')}
				><ArrowLeft width={15} height={15} aria-hidden="true" /></Button
			>
			<Button
				size="icon"
				variant="ghost"
				disabled={!currentBrowserTab?.url}
				aria-label="Forward"
				title="Forward"
				onclick={() => navigateBrowserHistory('forward')}
				><ArrowRight width={15} height={15} aria-hidden="true" /></Button
			>
			<Button
				size="icon"
				variant="ghost"
				disabled={!currentBrowserTab?.url}
				aria-label="Reload preview"
				title="Reload preview"
				onclick={reloadBrowser}><RefreshCw width={15} height={15} aria-hidden="true" /></Button
			>
			<Button
				size="icon"
				variant="ghost"
				disabled={!currentBrowserTab?.url}
				aria-label="Clean reload preview"
				title="Clear site data and reload preview"
				onclick={cleanReloadBrowser}><Eraser width={15} height={15} aria-hidden="true" /></Button
			>
			<Input
				class="h-8 min-w-32 text-xs"
				value={currentBrowserTab?.draft ?? ''}
				oninput={updateBrowserDraft}
				aria-label="Browser address"
				placeholder="http://localhost:5173"
			/>
			<Button size="sm" type="submit" title="Open address">Go</Button>
			<div class="browser-preset-actions" role="group" aria-label="Preview viewport">
				<Button
					size="icon"
					variant={browserDevice === 'desktop' ? 'secondary' : 'ghost'}
					aria-label="Desktop viewport"
					aria-pressed={browserDevice === 'desktop'}
					title="Desktop viewport"
					onclick={() => (browserDevice = 'desktop')}
					><Monitor width={15} height={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					variant={browserDevice === 'tablet' ? 'secondary' : 'ghost'}
					aria-label="Tablet viewport"
					aria-pressed={browserDevice === 'tablet'}
					title="Tablet viewport (768 × 1024)"
					onclick={() => (browserDevice = 'tablet')}
					><Tablet width={15} height={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					variant={browserDevice === 'mobile' ? 'secondary' : 'ghost'}
					aria-label="Mobile viewport"
					aria-pressed={browserDevice === 'mobile'}
					title="Mobile viewport (390 × 844)"
					onclick={() => (browserDevice = 'mobile')}
					><Smartphone width={15} height={15} aria-hidden="true" /></Button
				>
			</div>
			<div class="browser-preset-actions" role="group" aria-label="Preview zoom">
				<Button
					size="icon"
					variant="ghost"
					disabled={browserZoom <= 0.5}
					aria-label="Zoom out preview"
					title={`Zoom out preview (${browserZoom * 100}%)`}
					onclick={() => (browserZoom -= 0.25)}
					><ZoomOut width={15} height={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					variant="ghost"
					disabled={browserZoom >= 1.5}
					aria-label="Zoom in preview"
					title={`Zoom in preview (${browserZoom * 100}%)`}
					onclick={() => (browserZoom += 0.25)}
					><ZoomIn width={15} height={15} aria-hidden="true" /></Button
				>
			</div>
			<Button
				size="icon"
				variant={selectingElement ? 'secondary' : 'ghost'}
				disabled={!currentBrowserTab?.url || !onreviewcontext}
				aria-label={selectingElement ? 'Cancel element selection' : 'Select page element'}
				aria-pressed={selectingElement}
				title={selectingElement ? 'Cancel element selection' : 'Select page element for chat'}
				onclick={toggleElementSelection}
				><ScanSearch width={15} height={15} aria-hidden="true" /></Button
			>
			{#if nativePreview}<Button
					size="icon"
					variant="ghost"
					disabled={!currentBrowserTab?.url}
					aria-label="Toggle preview developer tools"
					title="Toggle preview developer tools"
					onclick={toggleDeveloperTools}
					><SquareTerminal width={15} height={15} aria-hidden="true" /></Button
				>{/if}
			{#if currentBrowserTab?.url}<a
					class="grid h-8 min-w-8 place-items-center rounded-md border border-border"
					href={currentBrowserTab.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open preview in system browser"
					title="Open preview in system browser"
					><ExternalLink width={15} height={15} aria-hidden="true" /></a
				>{/if}
		</form>
		{#if browserError}<small class="panel-error m-2 text-xs text-destructive" role="alert"
				>{browserError}</small
			>{/if}
	</header>
	<div
		class="min-h-0 min-w-0 flex-1 justify-center overflow-auto bg-muted/20"
		class:flex={Boolean(currentBrowserTab?.url)}
		class:hidden={!currentBrowserTab?.url}
	>
		{#each browserTabs.filter(({ mounted, url }) => mounted && url) as tab (tab.id)}
			{#key tab.reload}{#if nativePreview}<electrobun-webview
						use:trackBrowserFrame={tab.id}
						class="max-w-none shrink-0 border-0 bg-white"
						class:browser-frame-active={tab.id === activeBrowserTabId}
						class:hidden={tab.id !== activeBrowserTabId}
						class:h-full={browserDevice === 'desktop'}
						class:w-full={browserDevice === 'desktop'}
						style:width={browserDevice === 'desktop' ? undefined : `${browserSize.width}px`}
						style:height={browserDevice === 'desktop' ? undefined : `${browserSize.height}px`}
						style:zoom={browserZoom}
						title={tab.title}
						src={tab.source}
						sandbox
						aria-hidden={tab.id !== activeBrowserTabId}
					></electrobun-webview>{:else}<iframe
						use:trackBrowserFrame={tab.id}
						class="max-w-none shrink-0 border-0 bg-white"
						class:browser-frame-active={tab.id === activeBrowserTabId}
						class:hidden={tab.id !== activeBrowserTabId}
						class:h-full={browserDevice === 'desktop'}
						class:w-full={browserDevice === 'desktop'}
						width={browserSize.width}
						height={browserSize.height}
						style:zoom={browserZoom}
						title={tab.title}
						src={tab.source}
						aria-hidden={tab.id !== activeBrowserTabId}
						onload={(event) => syncBrowserFrame(event, tab.id)}
						sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
					></iframe>{/if}{/key}
		{/each}
	</div>
	{#if !currentBrowserTab?.url}<div
			class="panel-empty grid min-h-32 content-start justify-center gap-3 overflow-auto p-5 text-center text-xs text-muted-foreground"
		>
			<div class="grid gap-1.5">
				<strong class="text-foreground">Preview a local app or web page</strong>
				<span>Sites that block framing can still open externally.</span>
			</div>
			{#if visibleDevServers.length}
				<div class="grid w-full max-w-sm gap-1 text-left" aria-label="Available local servers">
					{#each visibleDevServers as server}
						<div class="flex min-w-0 gap-1 rounded-md bg-secondary p-1">
							<Button
								variant="ghost"
								size="icon"
								class="self-center"
								aria-label={`Hide port ${server.port}`}
								title={`Hide port ${server.port}`}
								onclick={() => hideServer(server.port)}
							>
								<EyeOff width={14} height={14} aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								class="h-auto min-w-0 flex-1 justify-start px-2 py-1.5 text-left font-normal"
								aria-label={`Open localhost:${server.port}`}
								onclick={() => openBrowserUrl(server.url)}
							>
								<Globe width={14} height={14} class="shrink-0" aria-hidden="true" />
								<span class="min-w-0">
									<strong class="block truncate text-xs text-foreground">localhost:{server.port}</strong>
									<span class="block truncate text-[11px] text-muted-foreground" title={server.folder}
										>{server.process} · PID {server.pid}{server.canStop ? '' : ' · HUE'}<br />{server.folder}</span
									>
								</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="self-center"
								disabled={!server.canStop || stoppingPid === server.pid}
								aria-label={`Stop ${server.process} on port ${server.port}`}
								title={server.canStop ? `Stop PID ${server.pid}` : 'HUE cannot stop itself'}
								onclick={() => stopServer(server)}
							>
								{stoppingPid === server.pid ? 'Stopping…' : 'Stop'}
							</Button>
						</div>
					{/each}
				</div>
			{:else if !discoveringServers}
				<span>{hiddenServerCount ? 'All local servers are hidden.' : 'No local servers found.'}</span>
			{/if}
			{#if hiddenServerCount}
				<Button variant="ghost" size="sm" class="mx-auto" onclick={showHiddenServers}
					>Show hidden ({hiddenServerCount})</Button
				>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				class="mx-auto"
				disabled={discoveringServers}
				onclick={discoverServers}
			>
				<RefreshCw
					width={14}
					height={14}
					class={discoveringServers ? 'animate-spin' : ''}
					aria-hidden="true"
				/>
				{discoveringServers ? 'Finding local servers…' : 'Refresh servers'}
			</Button>
		</div>{/if}
</article>
