<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import TooltipProvider from '$lib/components/TooltipProvider.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/icons/hue-192.png" />
	<meta name="theme-color" content="#181818" />
	<meta name="application-name" content="HUE" />
</svelte:head>
{@render children()}
<TooltipProvider />
