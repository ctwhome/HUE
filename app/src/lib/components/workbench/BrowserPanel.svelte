<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { ExternalLink, Monitor, Smartphone } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { afterInitialPaint } from './after-initial-paint';
	import {
		browserCanvasAddressKey,
		browserCanvasStorageKey,
		legacyBrowserStorageKey,
		migrateLegacyBrowserTabs,
		normalizeBrowserUrl,
		parseStoredBrowserAddress,
		type BrowserDevice
	} from './browser-canvas';
	import type { BrowserCanvasController } from './ExcalidrawBrowserCanvas';

	let {
		projectId,
		onpreviewchange
	}: { projectId: string; onpreviewchange: (url: string) => void } = $props();
	let canvasHost: HTMLDivElement;
	let controller: BrowserCanvasController | undefined;
	let address = $state('');
	let currentUrl = $state('');
	let error = $state('');
	let canvasReady = $state(false);
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	function useAddress(): string | null {
		try {
			const normalized = normalizeBrowserUrl(address);
			address = normalized;
			currentUrl = normalized;
			error = '';
			onpreviewchange(normalized);
			try {
				localStorage.setItem(browserCanvasAddressKey(projectId), normalized);
			} catch {
				error = 'Address could not be saved in this browser.';
			}
			return normalized;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Enter a valid http or https address';
			return null;
		}
	}
	function applyAddress(event: SubmitEvent) {
		event.preventDefault();
		useAddress();
	}
	function addBrowser(device: BrowserDevice) {
		const url = useAddress();
		if (!url || !controller) return;
		try {
			controller.addEmbed(device, url);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Canvas is still loading.';
		}
	}
	function savedAddress() {
		try {
			const addressKey = browserCanvasAddressKey(projectId);
			const sceneKey = browserCanvasStorageKey(projectId);
			const restored = parseStoredBrowserAddress(localStorage.getItem(addressKey));
			if (restored || localStorage.getItem(sceneKey) !== null) return restored;
			const legacyKey = legacyBrowserStorageKey(projectId);
			const migrated = migrateLegacyBrowserTabs(localStorage.getItem(legacyKey));
			if (!migrated) return '';
			// Write the complete scene first so a partial quota failure never discards the legacy tabs.
			localStorage.setItem(sceneKey, migrated.scene);
			localStorage.setItem(addressKey, migrated.address);
			localStorage.removeItem(legacyKey);
			return migrated.address;
		} catch {
			return '';
		}
	}

	onMount(() => {
		let cancelled = false;
		const restoredAddress = savedAddress();
		if (restoredAddress) {
			address = restoredAddress;
			currentUrl = restoredAddress;
			onpreviewchange(restoredAddress);
		} else onpreviewchange('');
		const mountCanvas = async () => {
			try {
				const { mountExcalidrawBrowserCanvas } = await import('./ExcalidrawBrowserCanvas');
				const mounted = await mountExcalidrawBrowserCanvas(canvasHost, {
					projectId,
					onready(restoredUrl) {
						if (cancelled) return;
						canvasReady = true;
						if (restoredUrl) {
							address = restoredUrl;
							currentUrl = restoredUrl;
							onpreviewchange(restoredUrl);
							try {
								localStorage.setItem(browserCanvasAddressKey(projectId), restoredUrl);
							} catch {
								error = 'Address could not be saved in this browser.';
							}
						}
					},
					onerror(message) {
						if (!cancelled) error = message;
					}
				});
				if (cancelled) mounted.destroy();
				else controller = mounted;
			} catch (cause) {
				if (!cancelled)
					error = cause instanceof Error ? cause.message : 'Canvas could not be loaded.';
			}
		};
		const cancelLoad = afterInitialPaint(() => void mountCanvas());
		return () => {
			cancelled = true;
			cancelLoad();
			controller?.destroy();
		};
	});

	onDestroy(() => controller?.flush());
</script>

<article class={`${panel} browser-panel`} aria-label="Project browser">
	<header class="browser-canvas-toolbar border-b border-border bg-muted/40 p-1.5">
		<form class="browser-address" onsubmit={applyAddress}>
			<Input
				class="h-9 min-w-0 text-xs"
				bind:value={address}
				aria-label="Browser address"
				placeholder="http://localhost:5173"
			/>
			<Button size="sm" type="submit" title="Apply address">Go</Button>
			{#if currentUrl}<a
					class="browser-external grid h-9 min-w-9 place-items-center rounded-md border border-border bg-background"
					href={currentUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open current address externally"
					title="Open current address externally"><ExternalLink size={15} aria-hidden="true" /></a
				>{/if}
		</form>
		<div class="browser-device-actions">
			<Button size="sm" disabled={!canvasReady} onclick={() => addBrowser('desktop')}
				><Monitor size={15} aria-hidden="true" />Add desktop</Button
			>
			<Button size="sm" disabled={!canvasReady} onclick={() => addBrowser('mobile')}
				><Smartphone size={15} aria-hidden="true" />Add mobile</Button
			>
			<span
				class="browser-frame-note text-muted-foreground"
				title="Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open externally."
				>Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open
				externally.</span
			>
		</div>
		{#if error}<small class="panel-error block px-1 pt-1 text-xs text-destructive" role="alert"
				>{error}</small
			>{/if}
	</header>
	<div class="browser-canvas relative min-h-0 min-w-0 flex-1" bind:this={canvasHost}>
		{#if !canvasReady}<div
				class="panel-empty pointer-events-none absolute inset-0 z-10 grid place-content-center gap-1.5 p-5 text-center text-xs text-muted-foreground"
			>
				<strong class="text-foreground">Loading Excalidraw canvas…</strong><span
					>Draw freely, then add desktop and mobile live previews.</span
				>
			</div>{/if}
	</div>
</article>
