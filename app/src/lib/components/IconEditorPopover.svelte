<script lang="ts">
	import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
	import { onDestroy } from 'svelte';
	import { Image, RotateCcw, SmilePlus, X } from 'lucide-svelte';
	import EmojiPicker from './EmojiPicker.svelte';

	let {
		popover = $bindable(),
		anchor,
		label,
		onimage,
		onselect
	}: {
		popover?: HTMLElement;
		anchor?: HTMLElement;
		label: string;
		onimage: (event: Event) => void;
		onselect: (icon: string | null) => void;
	} = $props();
	let stopPositioning: (() => void) | undefined;

	function position() {
		if (!anchor || !popover) return;
		stopPositioning?.();
		stopPositioning = autoUpdate(anchor, popover, () => {
			void computePosition(anchor, popover!, {
				strategy: 'fixed',
				placement: 'bottom-start',
				middleware: [
					offset(8),
					flip(),
					shift({ padding: 8 }),
					size({
						padding: 8,
						apply({ availableHeight, elements }) {
							elements.floating.style.maxHeight = `${availableHeight}px`;
						}
					})
				]
			}).then(({ x, y }) => {
				popover!.style.left = `${x}px`;
				popover!.style.top = `${y}px`;
			});
		});
	}

	function toggled(event: ToggleEvent) {
		if (event.newState === 'open') position();
		else {
			stopPositioning?.();
			stopPositioning = undefined;
		}
	}

	onDestroy(() => stopPositioning?.());

	function select(icon: string | null) {
		onselect(icon);
		popover?.hidePopover();
	}

	function chooseImage(event: Event) {
		onimage(event);
		popover?.hidePopover();
	}
</script>

<div
	bind:this={popover}
	popover="auto"
	role="dialog"
	aria-label={`${label} icon`}
	class="icon-editor-popover fixed m-0 w-[min(360px,calc(100vw-24px))] gap-2 overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card p-3 text-foreground shadow-2xl"
	ontoggle={toggled}
>
	<header class="flex items-center justify-between gap-3">
		<strong class="text-sm">Icon</strong>
		<button
			class="grid size-9 place-items-center rounded-lg hover:bg-accent"
			aria-label={`Close ${label} icon editor`}
			title="Close"
			onclick={() => popover?.hidePopover()}><X size={17} aria-hidden="true" /></button
		>
	</header>
	<div class="grid grid-cols-3 gap-2">
		<button class="icon-editor-action"><SmilePlus size={16} aria-hidden="true" /> Emoji</button>
		<label class="icon-editor-action cursor-pointer"><Image size={16} aria-hidden="true" /> Image<input
				type="file"
				accept="image/png,image/jpeg,image/gif,image/webp"
				class="sr-only"
				aria-label={`${label} icon image`}
				onchange={chooseImage}
			/></label
		>
		<button class="icon-editor-action" onclick={() => select(null)}><RotateCcw
				size={16}
				aria-hidden="true"
			/> Auto</button
		>
	</div>
	<EmojiPicker onselect={select} />
</div>
