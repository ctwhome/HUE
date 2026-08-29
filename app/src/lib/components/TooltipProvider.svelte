<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';

	let text = $state('');
	let x = $state(0);
	let y = $state(0);
	let tooltip = $state<HTMLDivElement>();
	let active: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function triggerFor(target: EventTarget | null) {
		return target instanceof Element
			? (target.closest<HTMLElement>('[title], [data-tooltip]') ?? null)
			: null;
	}

	function hide() {
		clearTimeout(timer);
		if (active?.getAttribute('aria-describedby') === 'app-tooltip') {
			active.removeAttribute('aria-describedby');
		}
		active = null;
		untrack(() => (text = ''));
	}

	function positionTooltip(trigger: HTMLElement, target: DOMRect, tip: DOMRect) {
		const gap = 8;
		const margin = 8;
		const room = {
			top: target.top - margin,
			right: innerWidth - target.right - margin,
			bottom: innerHeight - target.bottom - margin,
			left: target.left - margin
		};
		const side = trigger.closest('.global-rail')
			? room.right >= tip.width + gap
				? 'right'
				: 'left'
			: room.top >= tip.height + gap
				? 'top'
				: room.bottom >= tip.height + gap
					? 'bottom'
					: room.right >= tip.width + gap
						? 'right'
						: 'left';

		x =
			side === 'right'
				? target.right + gap
				: side === 'left'
					? target.left - tip.width - gap
					: target.left + (target.width - tip.width) / 2;
		y =
			side === 'bottom'
				? target.bottom + gap
				: side === 'top'
					? target.top - tip.height - gap
					: target.top + (target.height - tip.height) / 2;
		x = Math.max(margin, Math.min(innerWidth - tip.width - margin, x));
		y = Math.max(margin, Math.min(innerHeight - tip.height - margin, y));
	}

	function show(trigger: HTMLElement, delay: number) {
		if (matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)').matches) return;
		const label = trigger.dataset.tooltip ?? trigger.title;
		if (!label || trigger === active) return;

		clearTimeout(timer);
		if (trigger.title) {
			trigger.dataset.tooltip = trigger.title;
			trigger.removeAttribute('title');
		}
		active = trigger;
		trigger.setAttribute('aria-describedby', 'app-tooltip');
		timer = setTimeout(async () => {
			if (active !== trigger) return;
			text = label;
			await tick();
			const target = trigger.getBoundingClientRect();
			if (!tooltip) return;
			const tip = tooltip.getBoundingClientRect();
			positionTooltip(trigger, target, tip);
		}, delay);
	}

	onMount(() => {
		const onPointerOver = (event: PointerEvent) => {
			const trigger = triggerFor(event.target);
			if (trigger) show(trigger, 80);
		};
		const onPointerOut = (event: PointerEvent) => {
			if (active && event.relatedTarget instanceof Node && active.contains(event.relatedTarget))
				return;
			hide();
		};
		const onFocusIn = (event: FocusEvent) => {
			const trigger = triggerFor(event.target);
			if (trigger) show(trigger, 0);
		};

		document.addEventListener('pointerover', onPointerOver);
		document.addEventListener('pointerout', onPointerOut);
		document.addEventListener('focusin', onFocusIn);
		document.addEventListener('focusout', hide);
		document.addEventListener('pointerdown', hide);
		return () => {
			document.removeEventListener('pointerover', onPointerOver);
			document.removeEventListener('pointerout', onPointerOut);
			document.removeEventListener('focusin', onFocusIn);
			document.removeEventListener('focusout', hide);
			document.removeEventListener('pointerdown', hide);
		};
	});
</script>

{#if text}
	<div
		bind:this={tooltip}
		id="app-tooltip"
		class="app-tooltip"
		role="tooltip"
		style:left={`${x}px`}
		style:top={`${y}px`}
	>
		{text}
	</div>
{/if}
