<script lang="ts">
	import { onMount } from 'svelte';
	import Download from '~icons/lucide/download';
	import Link from '~icons/lucide/link';
	import Share2 from '~icons/lucide/share-2';
	import X from '~icons/lucide/x';
	import {
		INSTALL_DISMISSED_KEY,
		actionFailureStatus,
		installOfferVisible,
		pinGuidance
	} from '$lib/pwa/install-guidance';
	type InstallPrompt = Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	};
	let { projectName, sessionTitle }: { projectName?: string | null; sessionTitle?: string | null } =
		$props();
	let dialog: HTMLDialogElement;
	let deferred = $state<InstallPrompt | null>(null);
	let dismissed = $state(false);
	let status = $state('');
	let canShare = $state(false);

	onMount(() => {
		dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
		canShare = typeof navigator.share === 'function';
		const beforeinstallprompt = (event: Event) => {
			event.preventDefault();
			if (!dismissed) deferred = event as InstallPrompt;
		};
		window.addEventListener('beforeinstallprompt', beforeinstallprompt);
		return () => window.removeEventListener('beforeinstallprompt', beforeinstallprompt);
	});
	function open() {
		status = '';
		dialog.showModal();
	}
	async function install() {
		if (!deferred) return;
		await deferred.prompt();
		const choice = await deferred.userChoice;
		if (choice.outcome === 'dismissed') dismissInstall();
		else status = 'Install accepted. Browser controls completion.';
		deferred = null;
	}
	function dismissInstall() {
		localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
		dismissed = true;
		deferred = null;
		status = 'Install suggestion dismissed.';
	}
	async function copyLink() {
		try {
			if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
			await navigator.clipboard.writeText(location.href);
			status = 'Current link copied.';
		} catch (cause) {
			status = actionFailureStatus('copy', cause);
		}
	}
	async function shareLink() {
		if (!navigator.share) return copyLink();
		try {
			await navigator.share({ title: document.title, url: location.href });
			status = 'Browser share sheet opened.';
		} catch (cause) {
			status = actionFailureStatus('share', cause);
		}
	}
</script>

<button
	class="grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
	aria-label="Share, install, or pin current view"
	title="Share or pin"
	onclick={open}><Share2 aria-hidden="true" /></button
>
<dialog
	bind:this={dialog}
	class="m-auto w-[min(500px,calc(100vw-1rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/70"
	aria-labelledby="pin-guidance-title"
>
	<header class="flex items-start gap-3 border-b border-border p-4 pr-3">
		<div class="min-w-0 flex-1">
			<h2 id="pin-guidance-title" class="font-semibold">Share or pin</h2>
			<p class="mt-1 text-sm text-muted-foreground">{pinGuidance(projectName, sessionTitle)}</p>
		</div>
		<button
			class="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-accent"
			aria-label="Close share and pin guidance"
			title="Close"
			onclick={() => dialog.close()}><X aria-hidden="true" /></button
		>
	</header>
	<div class="grid gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
		{#if installOfferVisible(Boolean(deferred), dismissed)}<section
				class="grid gap-2 rounded-xl border border-border p-3"
			>
				<strong>Install HUE</strong>
				<p class="text-sm text-muted-foreground">
					Your browser supports an install prompt. Installation does not create dynamic Project or
					Session shortcuts.
				</p>
				<div class="flex flex-wrap gap-2">
					<button
						class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground"
						onclick={install}
						><Download aria-hidden="true" class="mr-2 inline size-4" />Install HUE</button
					><button class="min-h-11 rounded-lg border border-border px-4" onclick={dismissInstall}
						>Don’t suggest install again</button
					>
				</div>
			</section>{/if}
		<div class="flex flex-wrap gap-2">
			<button class="min-h-11 rounded-lg border border-border px-4" onclick={copyLink}
				><Link aria-hidden="true" class="mr-2 inline size-4" />Copy link</button
			>{#if canShare}<button
					class="min-h-11 rounded-lg border border-border px-4"
					onclick={shareLink}
					><Share2 aria-hidden="true" class="mr-2 inline size-4" />Share link</button
				>{/if}
		</div>
		<p class="text-sm text-muted-foreground">
			Browser menu fallback: choose “Add to Home Screen”, “Install app”, or bookmark if available.
			HUE cannot confirm launcher pinning.
		</p>
		{#if status}<p role="status" class="text-sm">{status}</p>{/if}
	</div>
</dialog>
