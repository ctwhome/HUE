<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { DirtyGuard } from '../workspace/dirty-guard';
	import ExternalLink from '~icons/lucide/external-link';
	import Info from '~icons/lucide/info';
	import Monitor from '~icons/lucide/monitor';
	import Smartphone from '~icons/lucide/smartphone';
	import Tablet from '~icons/lucide/tablet';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { afterInitialPaint } from './after-initial-paint';
	import { normalizeBrowserUrl, type BrowserDevice } from './browser-canvas';
	import { api } from './api';
	import { migrateLegacyExcalidraw, type ProjectExcalidrawState } from './excalidraw-migration';
	import type { BrowserCanvasController } from './ExcalidrawBrowserCanvas';

	let {
		projectId,
		onpreviewchange,
		dirtyGuard
	}: { projectId: string; onpreviewchange: (url: string) => void; dirtyGuard?: DirtyGuard } =
		$props();
	let canvasHost: HTMLDivElement;
	let controller: BrowserCanvasController | undefined;
	let address = $state('');
	let addressDirty = false;
	let currentUrl = $state('');
	let error = $state('');
	let canvasReady = $state(false);
	let saveChain = Promise.resolve();
	let scopedProjectId = '';
	let updatedAt: string | null = null;
	let sceneDirty = $state(false);
	let savedAddress = $state('');
	let saving = $state(false);
	let recovering = $state(false);
	let conflict = $state(false);
	let loaded = $state(false);
	let dirty = $derived(sceneDirty || address !== savedAddress);
	const dirtySource = untrack(() =>
		dirtyGuard?.register(() => {
			controller?.discard();
			address = savedAddress;
			addressDirty = false;
		})
	);
	$effect(() => dirtySource?.setDirty(dirty));
	const endpoint = () => `/api/projects/${encodeURIComponent(scopedProjectId)}/excalidraw`;

	function saveState(input: { address?: string; scene?: string }) {
		const request = saveChain.then(async () => {
			if (recovering) throw new Error('Canvas reload in progress.');
			if (conflict)
				throw new Error(
					'This canvas changed elsewhere. Export your draft, then reload the saved canvas.'
				);
			saving = true;
			try {
				const { state } = await api<{ state: ProjectExcalidrawState }>(endpoint(), {
					method: 'PATCH',
					body: JSON.stringify({ ...input, expectedUpdatedAt: updatedAt })
				});
				updatedAt = state.updatedAt;
				if (input.address !== undefined) savedAddress = state.address;
				error = '';
				return state;
			} catch (cause) {
				if (cause instanceof Error && cause.message.includes('canvas changed elsewhere'))
					conflict = true;
				throw cause;
			} finally {
				saving = false;
			}
		});
		saveChain = request.then(
			() => undefined,
			() => undefined
		);
		return request;
	}

	function useAddress(): string | null {
		if (!loaded || recovering) return null;
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
	async function saveNow() {
		try {
			await controller?.flush();
			if (address !== savedAddress) {
				const submitted = address;
				const normalized = normalizeBrowserUrl(submitted);
				await saveState({ address: normalized });
				if (address === submitted) {
					address = currentUrl = normalized;
					addressDirty = false;
					onpreviewchange(normalized);
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function exportRecovery() {
		if (!controller) return;
		const recovery = { ...JSON.parse(controller.exportScene()), hueAddress: address };
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(recovery)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'canvas-recovery.excalidraw';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1_000);
	}
	async function reloadSaved() {
		if (
			dirty &&
			!confirm(
				'Discard local canvas and address changes? Export a recovery copy first if you need them.'
			)
		)
			return;
		recovering = true;
		try {
			await saveChain;
			const { state } = await api<{ state: ProjectExcalidrawState | null }>(endpoint());
			updatedAt = state?.updatedAt ?? null;
			address = savedAddress = currentUrl = state?.address ?? '';
			addressDirty = false;
			controller?.replaceScene(state?.scene ?? '');
			conflict = false;
			error = '';
			onpreviewchange(currentUrl);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			recovering = false;
		}
	}
	onMount(() => {
		scopedProjectId = projectId;
		let cancelled = false;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (!sceneDirty && address === savedAddress && !saving) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', beforeUnload);
		const mountCanvas = async () => {
			try {
				const response = await api<{ state: ProjectExcalidrawState | null }>(endpoint());
				updatedAt = response.state?.updatedAt ?? null;
				const state = response.state ?? (await migrateLegacyExcalidraw(scopedProjectId, saveState));
				if (cancelled) return;
				savedAddress = state?.address ?? '';
				loaded = true;
				if (!addressDirty) {
					address = state?.address ?? '';
					currentUrl = address;
					onpreviewchange(address);
				}
				const { mountExcalidrawBrowserCanvas } = await import('./ExcalidrawBrowserCanvas');
				const mounted = await mountExcalidrawBrowserCanvas(canvasHost, {
					initialScene: state?.scene ?? '',
					onsave: async (scene) => void (await saveState({ scene })),
					ondirtychange(value) {
						sceneDirty = value;
						dirtySource?.setDirty(value || address !== savedAddress);
					},
					onready(restoredUrl) {
						if (cancelled) return;
						canvasReady = true;
						if (restoredUrl && !address) {
							address = restoredUrl;
							currentUrl = restoredUrl;
							onpreviewchange(restoredUrl);
							void saveState({ address: restoredUrl }).catch((cause) => {
								error = cause instanceof Error ? cause.message : String(cause);
							});
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
			dirtySource?.unregister();
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});
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
					title="Add desktop (1440 × 900)"
					><Monitor width={15} height={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					class="w-[27px] px-0"
					disabled={!canvasReady}
					onclick={() => addBrowser('tablet')}
					aria-label="Add tablet"
					title="Add tablet (768 × 1024)"
					><Tablet width={15} height={15} aria-hidden="true" /></Button
				>
				<Button
					size="icon"
					class="w-[27px] px-0"
					disabled={!canvasReady}
					onclick={() => addBrowser('mobile')}
					aria-label="Add mobile"
					title="Add mobile (390 × 844)"
					><Smartphone width={15} height={15} aria-hidden="true" /></Button
				>
			</div>
			<Button
				size="icon"
				variant="ghost"
				class="browser-frame-note w-7 cursor-help px-0 text-muted-foreground"
				aria-label="Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open externally."
				title="Sites that block framing through X-Frame-Options, CSP, or mixed-content rules must open externally."
				><Info width={15} height={15} aria-hidden="true" /></Button
			>
		</div>
		<form class="browser-address" onsubmit={applyAddress}>
			<Input
				class="h-9 min-w-0 text-xs"
				bind:value={address}
				oninput={() => (addressDirty = true)}
				aria-label="Browser address"
				placeholder="http://localhost:5173"
			/>
			<Button
				size="sm"
				type="submit"
				title="Apply address"
				disabled={!loaded || recovering || conflict}>Go</Button
			>
			{#if currentUrl}<a
					class="browser-external grid h-9 min-w-9 place-items-center rounded-md border border-border bg-background"
					href={currentUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open current address externally"
					title="Open current address externally"
					><ExternalLink width={15} height={15} aria-hidden="true" /></a
				>{/if}
		</form>
		<div class="col-span-full flex flex-wrap items-center gap-2 text-xs">
			<span role="status"
				>{saving
					? 'Saving canvas...'
					: dirty
						? 'Unsaved changes'
						: canvasReady
							? 'No unsaved changes'
							: 'Loading canvas...'}</span
			>
			<Button
				size="sm"
				disabled={!canvasReady || saving || recovering || conflict || !dirty}
				onclick={saveNow}>Save now</Button
			>
			<Button size="sm" variant="outline" disabled={!canvasReady} onclick={exportRecovery}
				>Export recovery</Button
			>
			{#if error}<Button
					size="sm"
					variant="outline"
					disabled={!canvasReady || saving || recovering}
					onclick={reloadSaved}>Reload saved canvas</Button
				>{/if}
		</div>
		{#if error}<small
				class="panel-error col-span-full block px-1 text-xs text-destructive"
				role="alert">{error}</small
			>{/if}
	</header>
	<div
		class="browser-canvas relative min-h-0 min-w-0 flex-1"
		inert={recovering}
		bind:this={canvasHost}
	>
		{#if !canvasReady}<div
				class="panel-empty pointer-events-none absolute inset-0 z-10 grid place-content-center gap-1.5 p-5 text-center text-xs text-muted-foreground"
			>
				<strong class="text-foreground">Loading Excalidraw canvas…</strong><span
					>Draw freely, then add live previews from a device preset.</span
				>
			</div>{/if}
	</div>
</div>
