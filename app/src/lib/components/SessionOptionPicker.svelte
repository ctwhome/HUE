<script lang="ts">
	import Bot from '~icons/lucide/bot';
	import Brain from '~icons/lucide/brain';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import FileCheck2 from '~icons/lucide/file-check-2';
	import Gauge from '~icons/lucide/gauge';
	import MessageCircleQuestion from '~icons/lucide/message-circle-question';
	import Radio from '~icons/lucide/radio';
	import ShieldAlert from '~icons/lucide/shield-alert';
	import ShieldCheck from '~icons/lucide/shield-check';
	import Zap from '~icons/lucide/zap';

	export type SessionOption = { value: string; name: string; description?: string | null };

	let {
		options,
		value,
		ariaLabel,
		kind,
		showLabel = false,
		disabled = false,
		onselect
	}: {
		options: SessionOption[];
		value: string;
		ariaLabel: string;
		kind: 'mode' | 'reasoning' | 'work';
		showLabel?: boolean;
		disabled?: boolean;
		onselect: (value: string) => void;
	} = $props();
	const instanceId = $props.id();
	const menuId = `${instanceId}-menu`;
	let menu = $state<HTMLElement>();
	let open = $state(false);
	let selected = $derived(options.find((option) => option.value === value) ?? options[0]);

	function iconFor(option: SessionOption | undefined) {
		const label = `${option?.value ?? ''} ${option?.name ?? ''}`.toLowerCase();
		if (kind === 'work') return label.includes('live') ? Radio : Bot;
		if (kind === 'reasoning') {
			if (label.includes('high') || label.includes('max')) return Zap;
			if (label.includes('low') || label.includes('minimal')) return Gauge;
			return Brain;
		}
		if (label.includes('accept') || label.includes('edit')) return FileCheck2;
		if (label.includes('bypass') || label.includes('unrestricted')) return ShieldAlert;
		if (label.includes("don't ask") || label.includes('dont ask')) return ShieldCheck;
		return MessageCircleQuestion;
	}

	function select(next: string) {
		menu?.hidePopover();
		onselect(next);
	}
	let SelectedIcon = $derived(iconFor(selected));
</script>

<button
	type="button"
	class="context-chip session-option-trigger inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-8 sm:min-w-8"
	aria-label={ariaLabel}
	aria-haspopup="menu"
	aria-expanded={open}
	popovertarget={menuId}
	title={`${ariaLabel}: ${selected?.name ?? value}`}
	{disabled}
>
	<SelectedIcon width={16} height={16} aria-hidden="true" />
	{#if showLabel}<span class="max-w-24 truncate">{selected?.name ?? value}</span>{/if}
	<ChevronDown width={12} height={12} aria-hidden="true" />
</button>
<div
	bind:this={menu}
	id={menuId}
	class="session-option-menu w-[min(300px,calc(100vw-24px))] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-2xl"
	popover="auto"
	role="menu"
	aria-label={`Choose ${ariaLabel.toLowerCase()}`}
	ontoggle={(event) => (open = (event.currentTarget as HTMLElement).matches(':popover-open'))}
>
	{#each options as option}
		{@const Icon = iconFor(option)}
		<button
			type="button"
			role="menuitemradio"
			aria-checked={option.value === value}
			class="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
			onclick={() => select(option.value)}
		>
			<Icon width={16} height={16} class="mt-0.5 shrink-0" aria-hidden="true" />
			<span class="grid min-w-0 flex-1 text-xs"
				><strong>{option.name}</strong>{#if option.description}<small class="text-muted-foreground"
						>{option.description}</small
					>{/if}</span
			>
			<span class="grid w-4 shrink-0 place-items-center pt-0.5"
				>{#if option.value === value}<Check width={15} height={15} aria-hidden="true" />{/if}</span
			>
		</button>
	{/each}
</div>
