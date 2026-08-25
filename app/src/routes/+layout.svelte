<script lang="ts">
	import '../app.css';
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
<TooltipProvider />
