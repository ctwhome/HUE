<script lang="ts">
	import '../app.css';
	import { updated } from '$app/state';
	import TooltipProvider from '$lib/components/TooltipProvider.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/icons/hue-192.png" />
	<meta name="theme-color" content="#050505" />
	<meta name="application-name" content="HUE" />
</svelte:head>
{@render children()}
{#if updated.current}
	<div
		class="fixed right-3 bottom-3 left-3 z-50 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm text-card-foreground shadow-lg sm:right-4 sm:left-auto"
		role="status"
		aria-live="polite"
	>
		<span>Update the application to restart.</span>
		<button
			class="min-h-11 shrink-0 rounded-md bg-primary px-4 font-medium text-primary-foreground"
			onclick={() => location.reload()}>Restart now</button
		>
	</div>
{/if}
<TooltipProvider />
