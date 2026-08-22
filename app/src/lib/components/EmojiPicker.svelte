<script lang="ts">
	import { onMount } from 'svelte';
	import emojiDataUrl from 'emoji-picker-element-data/en/emojibase/data.json?url';

	let { onselect }: { onselect: (emoji: string) => void } = $props();
	let container: HTMLDivElement;

	onMount(() => {
		let picker: HTMLElement | undefined;
		let disposed = false;
		void import('emoji-picker-element/picker').then(({ default: Picker }) => {
			if (disposed) return;
			picker = new Picker({ dataSource: emojiDataUrl });
			picker.classList.add('dark');
			picker.addEventListener('emoji-click', (event) => {
				onselect((event as CustomEvent<{ unicode: string }>).detail.unicode);
			});
			container.append(picker);
		});
		return () => {
			disposed = true;
			picker?.remove();
		};
	});
</script>

<div class="emoji-picker-host" bind:this={container}></div>
