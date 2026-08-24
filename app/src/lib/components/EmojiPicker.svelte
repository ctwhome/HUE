<script lang="ts">
	import { onMount } from 'svelte';
	import emojiDataUrl from 'emoji-picker-element-data/en/emojibase/data.json?url';

	let { onselect }: { onselect: (emoji: string) => void } = $props();
	let container: HTMLDivElement;

	onMount(() => {
		let picker: HTMLElement | undefined;
		let disposed = false;
		const root = document.documentElement;
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const updateTheme = () => {
			const theme = root.dataset.theme;
			picker?.classList.toggle(
				'dark',
				theme === 'dark' || theme === 'oled' || (theme === 'system' && media.matches)
			);
		};
		const observer = new MutationObserver(updateTheme);
		observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
		media.addEventListener('change', updateTheme);
		void import('emoji-picker-element/picker').then(({ default: Picker }) => {
			if (disposed) return;
			picker = new Picker({ dataSource: emojiDataUrl });
			updateTheme();
			picker.addEventListener('emoji-click', (event) => {
				onselect((event as CustomEvent<{ unicode: string }>).detail.unicode);
			});
			container.append(picker);
		});
		return () => {
			disposed = true;
			observer.disconnect();
			media.removeEventListener('change', updateTheme);
			picker?.remove();
		};
	});
</script>

<div class="emoji-picker-host" bind:this={container}></div>
