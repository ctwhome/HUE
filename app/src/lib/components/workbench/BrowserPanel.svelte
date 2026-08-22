<script lang="ts">
	import { onMount } from 'svelte';
	import { ExternalLink, Plus, X } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';

	type BrowserTab = { id: string; title: string; url: string; draft: string };

	let { projectId }: { projectId: string } = $props();
	let browserTabs = $state<BrowserTab[]>([]);
	let activeBrowserTabId = $state('');
	let browserError = $state('');
	let currentBrowserTab = $derived(activeBrowserTab());
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	const storageKey = () => `hue:browser:${projectId}`;
	const newBrowserTab = (): BrowserTab => ({
		id: crypto.randomUUID(),
		title: 'New tab',
		url: '',
		draft: ''
	});
	function restoreBrowserTabs() {
		try {
			const saved = JSON.parse(localStorage.getItem(storageKey()) ?? '[]') as BrowserTab[];
			browserTabs = saved.filter(
				(tab) =>
					typeof tab.id === 'string' && typeof tab.url === 'string' && typeof tab.title === 'string'
			);
		} catch {
			browserTabs = [];
		}
		if (!browserTabs.length) browserTabs = [newBrowserTab()];
		browserTabs = browserTabs.map((tab) => ({ ...tab, draft: tab.url }));
		activeBrowserTabId = browserTabs[0].id;
	}
	function saveBrowserTabs() {
		localStorage.setItem(
			storageKey(),
			JSON.stringify(browserTabs.map(({ id, title, url }) => ({ id, title, url })))
		);
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
	function navigateBrowser(event: SubmitEvent) {
		event.preventDefault();
		const tab = activeBrowserTab();
		if (!tab) return;
		try {
			if (!tab.draft.trim() || /\s/.test(tab.draft)) throw new Error();
			const url = new URL(/^https?:\/\//i.test(tab.draft) ? tab.draft : `http://${tab.draft}`);
			if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
			browserTabs = browserTabs.map((item) =>
				item.id === tab.id
					? { ...item, title: url.hostname || 'Browser', url: url.href, draft: url.href }
					: item
			);
			browserError = '';
			saveBrowserTabs();
		} catch {
			browserError = 'Enter a valid http or https address';
		}
	}
	function addBrowserTab() {
		const tab = newBrowserTab();
		browserTabs = [...browserTabs, tab];
		activeBrowserTabId = tab.id;
		browserError = '';
		saveBrowserTabs();
	}
	function closeBrowserTab(event: MouseEvent | KeyboardEvent, id: string) {
		event.stopPropagation();
		const remaining = browserTabs.filter((tab) => tab.id !== id);
		browserTabs = remaining.length ? remaining : [newBrowserTab()];
		if (activeBrowserTabId === id) activeBrowserTabId = browserTabs[0].id;
		saveBrowserTabs();
	}

	onMount(restoreBrowserTabs);
</script>

<article class={`${panel} browser-panel`} aria-label="Project browser">
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
						onclick={() => (activeBrowserTabId = tab.id)}>{tab.title}</button
					>
					<button
						class="grid h-full w-7 place-items-center"
						aria-label={`Close ${tab.title}`}
						title={`Close ${tab.title}`}
						onclick={(event) => closeBrowserTab(event, tab.id)}
						><X size={12} aria-hidden="true" /></button
					>
				</div>
			{/each}
			<Button
				variant="ghost"
				size="icon"
				class="add-tab size-9"
				title="New browser tab"
				aria-label="New browser tab"
				onclick={addBrowserTab}><Plus size={16} aria-hidden="true" /></Button
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
					title="Open browser tab externally"><ExternalLink size={15} aria-hidden="true" /></a
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
</article>
