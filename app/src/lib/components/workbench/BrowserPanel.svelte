<script lang="ts">
	import { onMount } from 'svelte';
	import ExternalLink from '~icons/lucide/external-link';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { normalizeBrowserUrl, restoreBrowserTabId, restoreBrowserView } from './browser-canvas';
	import ExcalidrawPanel from './ExcalidrawPanel.svelte';

	type BrowserTab = { id: string; title: string; url: string; draft: string };
	type View = 'browser' | 'excalidraw';

	let {
		projectId,
		onpreviewchange
	}: { projectId: string; onpreviewchange: (url: string) => void } = $props();
	let view = $state<View>('browser');
	let excalidrawMounted = $state(false);
	let browserTabs = $state<BrowserTab[]>([]);
	let activeBrowserTabId = $state('');
	let browserError = $state('');
	let excalidrawUrl = $state('');
	let currentBrowserTab = $derived(activeBrowserTab());
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	const storageKey = () => `hue:browser:${projectId}`;
	const activeStorageKey = () => `${storageKey()}:active`;
	const viewStorageKey = () => `${storageKey()}:view`;
	const newBrowserTab = (): BrowserTab => ({
		id: crypto.randomUUID(),
		title: 'New tab',
		url: '',
		draft: ''
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
					return [{ ...tab, url, draft: url }];
				} catch {
					return [];
				}
			});
		} catch {
			browserTabs = [];
		}
		if (!browserTabs.length) browserTabs = [newBrowserTab()];
		activeBrowserTabId = restoreBrowserTabId(browserTabs, localStorage.getItem(activeStorageKey()));
		view = restoreBrowserView(localStorage.getItem(viewStorageKey()));
		excalidrawMounted = view === 'excalidraw';
		onpreviewchange(view === 'browser' ? (activeBrowserTab()?.url ?? '') : '');
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
	function selectView(next: View) {
		view = next;
		if (next === 'excalidraw') excalidrawMounted = true;
		try {
			localStorage.setItem(viewStorageKey(), next);
		} catch {
			browserError = 'Browser view could not be saved in this browser.';
		}
		onpreviewchange(next === 'browser' ? (activeBrowserTab()?.url ?? '') : excalidrawUrl);
	}
	function updateExcalidrawPreview(url: string) {
		excalidrawUrl = url;
		if (view === 'excalidraw') onpreviewchange(url);
	}
	function handleViewKeydown(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		let next: View;
		if (event.key === 'Home') next = 'browser';
		else if (event.key === 'End') next = 'excalidraw';
		else if (event.key === 'ArrowLeft') next = view === 'browser' ? 'excalidraw' : 'browser';
		else next = view === 'excalidraw' ? 'browser' : 'excalidraw';
		selectView(next);
		document.getElementById(`${next}-view-tab`)?.focus();
	}
	function updateBrowserDraft(event: Event) {
		const draft = (event.currentTarget as HTMLInputElement).value;
		browserTabs = browserTabs.map((tab) =>
			tab.id === activeBrowserTabId ? { ...tab, draft } : tab
		);
	}
	function navigateBrowser(event: SubmitEvent) {
		event.preventDefault();
		const tab = activeBrowserTab();
		if (!tab) return;
		let url: URL;
		try {
			url = new URL(normalizeBrowserUrl(tab.draft));
		} catch {
			browserError = 'Enter a valid http or https address';
			return;
		}
		browserTabs = browserTabs.map((item) =>
			item.id === tab.id
				? { ...item, title: url.hostname || 'Browser', url: url.href, draft: url.href }
				: item
		);
		browserError = '';
		saveBrowserTabs();
		onpreviewchange(url.href);
	}
	function addBrowserTab() {
		const tab = newBrowserTab();
		browserTabs = [...browserTabs, tab];
		activeBrowserTabId = tab.id;
		browserError = '';
		saveBrowserTabs();
		onpreviewchange('');
	}
	function closeBrowserTab(event: MouseEvent | KeyboardEvent, id: string) {
		event.stopPropagation();
		const remaining = browserTabs.filter((tab) => tab.id !== id);
		browserTabs = remaining.length ? remaining : [newBrowserTab()];
		if (activeBrowserTabId === id) activeBrowserTabId = browserTabs[0].id;
		saveBrowserTabs();
		onpreviewchange(activeBrowserTab()?.url ?? '');
	}
	function selectBrowserTab(tab: BrowserTab) {
		activeBrowserTabId = tab.id;
		saveBrowserTabs();
		onpreviewchange(tab.url);
	}

	onMount(restoreBrowserTabs);
</script>

<article class={`${panel} browser-panel`} aria-label="Project browser">
	<div
		class="flex min-w-0 border-b border-border bg-muted/40"
		role="tablist"
		aria-label="Browser and Excalidraw views"
	>
		<button
			id="browser-view-tab"
			class="min-h-11 flex-1 border-r border-border px-3 text-xs"
			class:bg-background={view === 'browser'}
			role="tab"
			aria-selected={view === 'browser'}
			aria-controls="browser-view-panel"
			tabindex={view === 'browser' ? 0 : -1}
			onkeydown={handleViewKeydown}
			onclick={() => selectView('browser')}>Browser</button
		>
		<button
			id="excalidraw-view-tab"
			class="min-h-11 flex-1 px-3 text-xs"
			class:bg-background={view === 'excalidraw'}
			role="tab"
			aria-selected={view === 'excalidraw'}
			aria-controls="excalidraw-view-panel"
			tabindex={view === 'excalidraw' ? 0 : -1}
			onkeydown={handleViewKeydown}
			onclick={() => selectView('excalidraw')}>Excalidraw</button
		>
	</div>
	<div
		id="browser-view-panel"
		class="min-h-0 min-w-0 flex-1 flex-col"
		class:flex={view === 'browser'}
		class:hidden={view !== 'browser'}
		role="tabpanel"
		aria-labelledby="browser-view-tab"
		aria-hidden={view !== 'browser'}
		inert={view !== 'browser'}
	>
		<header class="grid border-b border-border bg-muted/40 p-0">
			<div
				class="browser-tabs flex min-w-0 overflow-x-auto border-b border-border"
				role="tablist"
				aria-label="Browser tabs"
			>
				{#each browserTabs as tab}
					<div
						class="browser-tab flex min-h-9 min-w-24 flex-[0_1_150px] items-center border-r border-border bg-background text-xs text-muted-foreground"
						class:active={tab.id === activeBrowserTabId}
					>
						<button
							class="h-full min-w-0 flex-1 overflow-hidden px-2 text-left text-ellipsis whitespace-nowrap"
							role="tab"
							aria-selected={tab.id === activeBrowserTabId}
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
				class="browser-address grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5 p-1.5"
				onsubmit={navigateBrowser}
			>
				<Input
					class="h-8 text-xs"
					value={currentBrowserTab?.draft ?? ''}
					oninput={updateBrowserDraft}
					aria-label="Browser address"
					placeholder="http://localhost:5173"
				/>
				<Button size="sm" type="submit" title="Open address">Go</Button>
				{#if currentBrowserTab?.url}<a
						class="grid h-8 min-w-8 place-items-center rounded-md border border-border"
						href={currentBrowserTab.url}
						target="_blank"
						rel="noopener noreferrer"
						title="Open browser tab externally"
						><ExternalLink width={15} height={15} aria-hidden="true" /></a
					>{/if}
			</form>
			{#if browserError}<small class="panel-error m-2 text-xs text-destructive" role="alert"
					>{browserError}</small
				>{/if}
		</header>
		{#if currentBrowserTab?.url}<iframe
				class="min-h-0 w-full flex-1 border-0 bg-white"
				title={currentBrowserTab.title}
				src={currentBrowserTab.url}
				sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
			></iframe>{:else}<div
				class="panel-empty grid min-h-32 place-content-center gap-1.5 p-5 text-center text-xs text-muted-foreground"
			>
				<strong class="text-foreground">Preview a local app or web page</strong><span
					>Sites that block framing can still open externally.</span
				>
			</div>{/if}
	</div>
	{#if excalidrawMounted}<div
			id="excalidraw-view-panel"
			class="min-h-0 min-w-0 flex-1 flex-col"
			class:flex={view === 'excalidraw'}
			class:hidden={view !== 'excalidraw'}
			role="tabpanel"
			aria-labelledby="excalidraw-view-tab"
			aria-hidden={view !== 'excalidraw'}
			inert={view !== 'excalidraw'}
		>
			<ExcalidrawPanel {projectId} onpreviewchange={updateExcalidrawPreview} />
		</div>{/if}
</article>
