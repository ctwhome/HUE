<script lang="ts">
	let {
		pane,
		'aria-label': label,
		min,
		value,
		onpointerdown,
		onpointermove,
		onfinish,
		onkeydown
	}: {
		pane: 'projects' | 'sessions';
		'aria-label': string;
		min: number;
		value: number;
		onpointerdown: (event: PointerEvent) => void;
		onpointermove: (event: PointerEvent) => void;
		onfinish: () => void;
		onkeydown: (event: KeyboardEvent) => void;
	} = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
<div
	class={`shell-resizer ${pane === 'projects' ? 'project-pane-resizer' : 'session-pane-resizer'}`}
	role="separator"
	aria-label={label}
	aria-orientation="vertical"
	aria-valuemin={min}
	aria-valuenow={Math.round(value)}
	tabindex="0"
	data-pane={pane}
	{onpointerdown}
	{onpointermove}
	onpointerup={onfinish}
	onpointercancel={onfinish}
	{onkeydown}
></div>
