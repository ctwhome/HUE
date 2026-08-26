<script lang="ts">
	import { Check, ChevronDown, ChevronRight, CircleDot, Ellipsis, X } from 'lucide-svelte';
	import { compactModelLabel } from './workspace/mobile-navigation';

	export type ModelOption = { modelId: string; name: string; description?: string | null };

	let {
		models,
		value,
		ariaLabel = 'Hermes model',
		ellipsis = false,
		disabled = false,
		onselect
	}: {
		models: ModelOption[];
		value: string;
		ariaLabel?: string;
		ellipsis?: boolean;
		disabled?: boolean;
		onselect: (modelId: string) => void;
	} = $props();
	const instanceId = $props.id();
	const id = `${instanceId}-menu`;
	let popover = $state<HTMLElement>();
	let open = $state(false);
	let search = $state('');
	let selected = $derived(models.find((model) => model.modelId === value));
	let categories = $derived.by(() => {
		const labels: Record<string, string> = {
			anthropic: 'Anthropic',
			google: 'Google',
			openai: 'OpenAI',
			'openai-codex': 'OpenAI Codex',
			openrouter: 'OpenRouter'
		};
		const query = search.trim().toLowerCase();
		const grouped = new Map<string, ModelOption[]>();
		for (const model of models) {
			if (
				query &&
				!`${model.name} ${model.modelId} ${model.description ?? ''}`.toLowerCase().includes(query)
			)
				continue;
			const provider = model.modelId.includes(':') ? model.modelId.split(':', 1)[0] : 'other';
			const label = labels[provider] ?? provider.replace(/(^|[-_])\w/g, (part) => part.toUpperCase());
			grouped.set(label, [...(grouped.get(label) ?? []), model]);
		}
		return [...grouped].map(([name, options]) => ({ name, models: options }));
	});

	function select(modelId: string) {
		popover?.hidePopover();
		onselect(modelId);
	}
</script>

	<button
	type="button"
	class={`context-chip context-select context-model inline-flex min-h-8 shrink-0 items-center rounded-lg text-xs hover:bg-accent ${ellipsis ? 'size-8 justify-center p-0 max-[700px]:size-11' : 'max-w-40 gap-1.5 px-2'}`}
	aria-label={ariaLabel}
	aria-haspopup="menu"
	aria-expanded={open}
	popovertarget={id}
	title={ellipsis
		? `${ariaLabel}: ${selected?.name ?? value}`
		: `${selected?.name ?? value} · ${value}`}
	{disabled}
>
	{#if ellipsis}<Ellipsis size={18} aria-hidden="true" />{:else}<CircleDot
			size={14}
			aria-hidden="true"
		/>
		<span>{compactModelLabel(value, selected?.name ?? value)}</span>
		<ChevronDown size={13} aria-hidden="true" />{/if}
</button>
<div
	bind:this={popover}
	{id}
	class="model-menu max-h-[min(520px,calc(100dvh-24px))] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-card p-2 text-foreground shadow-2xl open:flex"
	popover="auto"
	role="menu"
	aria-label={`Choose ${ariaLabel.toLowerCase()}`}
	ontoggle={(event) => (open = (event.currentTarget as HTMLElement).matches(':popover-open'))}
>
	<header>
		<div>
			<strong>Choose model</strong><small class="block text-muted-foreground"
				>Current: {selected?.name ?? value}</small
			>
		</div>
		<button
			type="button"
			class="model-menu-close"
			aria-label="Close model picker"
			title="Close model picker"
			onclick={() => popover?.hidePopover()}><X size={18} aria-hidden="true" /></button
		>
	</header>
	<label class="model-search"
		><span class="sr-only">Search models</span><input
			bind:value={search}
			type="search"
			aria-label="Search models"
			placeholder="Search models"
		/></label
	>
	<div class="model-list min-h-0 flex-1 overflow-y-auto">
		{#each categories as category}
			<details open={Boolean(search) || category.models.some((model) => model.modelId === value)}>
				<summary>
					<span>{category.name}</span>
					<small>{category.models.length} {category.models.length === 1 ? 'model' : 'models'}</small>
					<ChevronRight size={14} aria-hidden="true" />
				</summary>
				<div class="model-options pb-1.5">
					{#each category.models as model}<button
							type="button"
							role="menuitemradio"
							aria-checked={model.modelId === value}
							title={`Use ${model.name} · ${model.modelId}`}
							onclick={() => select(model.modelId)}
						>
							<span class="model-check pt-0.5 text-primary"
								>{#if model.modelId === value}<Check size={15} aria-hidden="true" />{/if}</span
							>
							<span
								><strong>{model.name}</strong><small
									>{model.modelId}{model.description ? ` · ${model.description}` : ''}</small
								></span
							>
						</button>{/each}
				</div>
			</details>
		{/each}
		{#if categories.length === 0}<p class="p-3 text-sm text-muted-foreground">No matching models.</p>{/if}
	</div>
</div>
