<script lang="ts">
	let {
		label,
		firstWeight,
		secondWeight,
		onresize
	}: {
		label: string;
		firstWeight: number;
		secondWeight: number;
		onresize: (first: number, second: number) => void;
	} = $props();
	let start: { y: number; first: number; second: number } | null = null;
	const percent = $derived(Math.round((firstWeight / (firstWeight + secondWeight)) * 100));

	function panels(target: HTMLElement) {
		return [target.previousElementSibling, target.nextElementSibling] as [HTMLElement, HTMLElement];
	}
	function setHeights(first: number, second: number, delta: number) {
		const total = first + second;
		const minimum = Math.min(88, total / 2);
		const next = Math.min(total - minimum, Math.max(minimum, first + delta));
		onresize(next, total - next);
	}
	function startResize(event: PointerEvent) {
		const [first, second] = panels(event.currentTarget as HTMLElement);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		start = { y: event.clientY, first: first.clientHeight, second: second.clientHeight };
	}
	function resize(event: PointerEvent) {
		if (start) setHeights(start.first, start.second, event.clientY - start.y);
	}
	function finishResize() {
		start = null;
	}
	function resizeWithKeyboard(event: KeyboardEvent) {
		if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const [first, second] = panels(event.currentTarget as HTMLElement);
		setHeights(
			first.clientHeight,
			second.clientHeight,
			event.key === 'Home'
				? -first.clientHeight
				: event.key === 'End'
					? second.clientHeight
					: event.key === 'ArrowDown'
						? 24
						: -24
		);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
<div
	class="git-panel-resizer"
	role="separator"
	aria-label={label}
	aria-orientation="horizontal"
	aria-valuemin="10"
	aria-valuemax="90"
	aria-valuenow={percent}
	tabindex="0"
	onpointerdown={startResize}
	onpointermove={resize}
	onpointerup={finishResize}
	onpointercancel={finishResize}
	onkeydown={resizeWithKeyboard}
></div>
