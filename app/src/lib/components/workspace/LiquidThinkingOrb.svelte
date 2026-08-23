<script lang="ts">
	import { onMount } from 'svelte';

	let { thought, sequence }: { thought?: string; sequence?: number } = $props();
	let canvas: HTMLCanvasElement;
	let ready = $state(false);

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let disposed = false;
		let generation = 0;
		let stopRenderer: (() => void) | undefined;

		async function start() {
			const current = ++generation;
			stopRenderer?.();
			stopRenderer = undefined;
			ready = false;
			if (motion.matches || !navigator.gpu) return;
			const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
			if (!context) return;
			try {
				const { mountLiquidOrb } = await import('./liquid-orb-renderer');
				if (disposed || current !== generation || motion.matches) return;
				stopRenderer = mountLiquidOrb(canvas, context, {
					onReady: () => (ready = true),
					onError: () => (ready = false)
				});
			} catch {
				ready = false;
			}
		}

		void start();
		motion.addEventListener('change', start);
		return () => {
			disposed = true;
			motion.removeEventListener('change', start);
			stopRenderer?.();
		};
	});
</script>

<section
	class="active-thinking mx-auto mb-6 max-w-[774px]"
	aria-label="Hermes reasoning"
	data-timeline-sequence={sequence}
>
	<div class="liquid-thinking-orb" class:gpu-ready={ready} aria-hidden="true">
		<span class="liquid-thinking-wave"></span>
		<canvas bind:this={canvas}></canvas>
	</div>
	{#if thought}<details class="active-reasoning">
			<summary>Hermes reasoning</summary>
			<div class="active-reasoning-text">{thought}</div>
		</details>{:else}<p class="thinking-label">Hermes reasoning</p>{/if}
</section>
