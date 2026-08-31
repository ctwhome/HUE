<script lang="ts">
	import { onMount } from 'svelte';
	import { DiffModeEnum, DiffView } from '@git-diff-view/svelte';
	import '@git-diff-view/svelte/styles/diff-view-pure.css';
	import type { FileDiffData } from './repository-diff';

	let {
		data,
		theme
	}: {
		data: FileDiffData;
		theme: 'light' | 'dark';
	} = $props();
	let element: HTMLElement;
	let narrow = $state(true);

	onMount(() => {
		const observer = new ResizeObserver(([entry]) => (narrow = entry.contentRect.width < 640));
		observer.observe(element);
		return () => observer.disconnect();
	});
</script>

<div class="min-w-0" bind:this={element}>
	<DiffView
		{data}
		diffViewMode={narrow ? DiffModeEnum.Unified : DiffModeEnum.Split}
		diffViewTheme={theme}
		diffViewHighlight={true}
		diffViewWrap={narrow}
		diffViewFontSize={12}
	/>
</div>
