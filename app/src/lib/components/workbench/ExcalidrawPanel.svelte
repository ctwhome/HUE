<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { ExternalLink, Info, Monitor, Smartphone, Tablet } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { afterInitialPaint } from './after-initial-paint';
	import { normalizeBrowserUrl, type BrowserDevice } from './browser-canvas';
	import { api } from './api';
	import { migrateLegacyExcalidraw, type ProjectExcalidrawState } from './excalidraw-migration';
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
	let saveChain = Promise.resolve();
	const endpoint = () => `/api/projects/${encodeURIComponent(projectId)}/excalidraw`;

	function saveState(input: { address?: string; scene?: string }) {
		const request = saveChain.then(() =>
			api<{ state: ProjectExcalidrawState }>(endpoint(), {
				method: 'PATCH',
				body: JSON.stringify(input)
			}).then(({ state }) => state)
		);
		saveChain = request.then(
			() => undefined,
			() => undefined
		);
		return request;
	}

	function useAddress(): string | null {
		try {
			const normalized = normalizeBrowserUrl(address);
			address = normalized;
			currentUrl = normalized;
			error = '';
			onpreviewchange(normalized);
			void saveState({ address: normalized }).catch((cause) => {
				error = cause instanceof Error ? cause.message : 'Address could not be saved to HUE.';
			});
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
	onMount(() => {
		let cancelled = false;
		const mountCanvas = async () => {
			try {
				const loaded = await api<{ state: ProjectExcalidrawState | null }>(endpoint());
				const state = loaded.state ?? (await migrateLegacyExcalidraw(projectId, saveState));
				if (cancelled) return;
				address = state?.address ?? '';
				currentUrl = address;
				onpreviewchange(address);
				const { mountExcalidrawBrowserCanvas } = await import('./ExcalidrawBrowserCanvas');
				const mounted = await mountExcalidrawBrowserCanvas(canvasHost, {
					initialScene: state?.scene ?? '',
					onsave: async (scene) => void (await saveState({ scene })),
					onready(restoredUrl) {
						if (cancelled) return;
						canvasReady = true;
						if (restoredUrl && !address) {
							address = restoredUrl;
							currentUrl = restoredUrl;
							onpreviewchange(restoredUrl);
							void saveState({ address: restoredUrl });
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

	onDestroy(() => void controller?.flush());
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Project Excalidraw">
	<header class="browser-canvas-toolbar border-b border-border bg-muted/40 p-1.5">
		<div class="browser-responsive-actions">
			<div class="browser-preset-actions" role="group" aria-label="Add preview preset">
				<Button
					size="icon"
					class="w-[27px] px-0"
					disabled={!canvasReady}
					onclick={() => addBrowser('desktop')}
					aria-label="Add desktop"
					title="Add desktop (1440 × 900)"><Monitor size={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					class="w-[27px] px-0"
					disabled={!canvasReady}
					onclick={() => addBrowser('tablet')}
					aria-label="Add tablet"
					title="Add tablet (768 × 1024)"><Tablet size={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					class="w-[27px] px-0"
					disabled={!canvasReady}
					onclick={() => addBrowser('mobile')}
					aria-label="Add mobile"
					title="Add mobile (390 × 844)"><Smartphone size={15} aria-hidden="true" /></Button
				>
			</div>
			<Button
				size="icon"
				variant="ghost"
				class="browser-frame-note w-7 cursor-help px-0 text-muted-foreground"
				aria-label="Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open externally."
				title="Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open externally."
				><Info size={15} aria-hidden="true" /></Button
			>
		</div>
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
		{#if error}<small
				class="panel-error col-span-full block px-1 text-xs text-destructive"
				role="alert">{error}</small
			>{/if}
	</header>
	<div class="browser-canvas relative min-h-0 min-w-0 flex-1" bind:this={canvasHost}>
		{#if !canvasReady}<div
				class="panel-empty pointer-events-none absolute inset-0 z-10 grid place-content-center gap-1.5 p-5 text-center text-xs text-muted-foreground"
			>
				<strong class="text-foreground">Loading Excalidraw canvas…</strong><span
					>Draw freely, then add live previews from a device preset.</span
				>
			</div>{/if}
	</div>
</div>
