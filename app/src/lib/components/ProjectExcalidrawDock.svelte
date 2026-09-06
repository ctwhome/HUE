<script lang="ts">
	import { onMount } from 'svelte';
	import ExcalidrawPanel from './workbench/ExcalidrawPanel.svelte';

	let {
		projectId,
		open,
		onpreviewchange
	}: { projectId: string; open: boolean; onpreviewchange: (url: string) => void } = $props();
	let dockElement: HTMLElement;
	let width = $state(720);
	let maxWidth = $state(720);
	let mounted = $state(false);
	let resizeStart: { x: number; width: number } | null = null;
	$effect(() => {
		if (open) mounted = true;
	});

	function limits() {
		const available = dockElement.parentElement?.clientWidth ?? innerWidth;
		const toolsWidth = dockElement.nextElementSibling?.clientWidth ?? 52;
		return { min: 360, max: Math.max(360, available - toolsWidth - 280) };
	}
	function setWidth(next: number) {
		const { min, max } = limits();
		maxWidth = max;
		width = Math.min(max, Math.max(min, next));
	}
	function saveWidth() {
		localStorage.setItem(`hue:project-excalidraw:${projectId}:width`, String(Math.round(width)));
	}
	function startResize(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		resizeStart = { x: event.clientX, width };
	}
	function resize(event: PointerEvent) {
		if (resizeStart) setWidth(resizeStart.width + resizeStart.x - event.clientX);
	}
	function finishResize() {
		if (!resizeStart) return;
		resizeStart = null;
		saveWidth();
	}
	function resizeWithKeyboard(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const { min, max } = limits();
		setWidth(
			event.key === 'Home'
				? min
				: event.key === 'End'
					? max
					: width + (event.key === 'ArrowLeft' ? 24 : -24)
		);
		saveWidth();
	}

	onMount(() => {
		const savedWidth = Number(localStorage.getItem(`hue:project-excalidraw:${projectId}:width`));
		const frame = requestAnimationFrame(() => setWidth(savedWidth > 0 ? savedWidth : 720));
		const observer = new ResizeObserver(() => setWidth(width));
		observer.observe(dockElement.parentElement!);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});
</script>

<aside
	bind:this={dockElement}
	class="project-excalidraw-dock flex min-h-0 min-w-0 flex-col bg-background"
	class:open
	style={`--project-excalidraw-width: ${width}px`}
	aria-label="Project Excalidraw"
>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
	{#if open}<div
			class="project-excalidraw-resizer"
			role="separator"
			aria-label="Resize project Excalidraw"
			aria-orientation="vertical"
			aria-valuemin="360"
			aria-valuemax={maxWidth}
			aria-valuenow={Math.round(width)}
			tabindex="0"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
			onkeydown={resizeWithKeyboard}
		></div>{/if}
	<section
		aria-hidden={!open}
		inert={!open ? true : undefined}
		class="min-h-0 flex-1 px-2.5 pt-2.5"
	>
		{#if mounted}<article
				class="workbench-panel browser-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
				aria-label="Project Excalidraw canvas"
			>
				<ExcalidrawPanel {projectId} {onpreviewchange} />
			</article>{/if}
	</section>
</aside>
