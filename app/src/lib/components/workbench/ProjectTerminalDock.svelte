<script lang="ts">
	import { onMount, type Component } from 'svelte';

	let { projectId, height = $bindable(300) }: { projectId: string; height?: number } = $props();
	let TerminalPanel = $state<Component<{ projectId: string }> | null>(null);
	let error = $state('');
	let element: HTMLElement;
	let resizeStart: { y: number; height: number } | null = null;

	function limits() {
		const available = element.parentElement?.clientHeight ?? innerHeight;
		return { min: 160, max: Math.max(160, available - 240) };
	}
	function setHeight(next: number) {
		const { min, max } = limits();
		height = Math.min(max, Math.max(min, next));
	}
	function saveHeight() {
		localStorage.setItem(
			`hue:project-tools:${projectId}:terminal-height`,
			String(Math.round(height))
		);
	}
	function startResize(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		resizeStart = { y: event.clientY, height };
	}
	function resize(event: PointerEvent) {
		if (resizeStart) setHeight(resizeStart.height + resizeStart.y - event.clientY);
	}
	function finishResize() {
		if (!resizeStart) return;
		resizeStart = null;
		saveHeight();
	}
	function resizeWithKeyboard(event: KeyboardEvent) {
		if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const { min, max } = limits();
		setHeight(
			event.key === 'Home'
				? min
				: event.key === 'End'
					? max
					: height + (event.key === 'ArrowUp' ? 24 : -24)
		);
		saveHeight();
	}

	onMount(() => {
		let mounted = true;
		const savedHeight = Number(
			localStorage.getItem(`hue:project-tools:${projectId}:terminal-height`)
		);
		setHeight(savedHeight > 0 ? savedHeight : element.parentElement!.clientHeight * 0.34);
		void import('./TerminalPanel.svelte')
			.then((module) => {
				if (mounted) TerminalPanel = module.default;
			})
			.catch((cause) => {
				if (mounted) error = cause instanceof Error ? cause.message : String(cause);
			});
		return () => {
			mounted = false;
		};
	});
</script>

<section bind:this={element} class="workspace-terminal-dock" aria-label="Workspace terminal panel">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
	<div
		class="terminal-resizer"
		role="separator"
		aria-label="Resize Terminal"
		aria-orientation="horizontal"
		aria-valuemin="160"
		aria-valuenow={Math.round(height)}
		tabindex="0"
		onpointerdown={startResize}
		onpointermove={resize}
		onpointerup={finishResize}
		onpointercancel={finishResize}
		onkeydown={resizeWithKeyboard}
	></div>
	{#if TerminalPanel}
		<TerminalPanel {projectId} />
	{:else}
		<article
			class="workbench-panel terminal-panel grid h-full place-content-center gap-2 rounded-xl border border-border bg-card p-4 text-center"
			aria-label="Project terminal"
		>
			<strong class="text-sm">Terminal</strong>
			<span class="text-xs text-muted-foreground">{error || 'Starting terminal…'}</span>
		</article>
	{/if}
</section>
