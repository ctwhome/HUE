<script lang="ts">
	import {
		chatBackgroundStyle,
		chatBackgroundTemplates,
		type ChatBackground
	} from './chat-background';

	let {
		value,
		inherit = false,
		onselect,
		onupload
	}: {
		value: ChatBackground | null;
		inherit?: boolean;
		onselect: (background: ChatBackground | null) => void;
		onupload: (event: Event) => void;
	} = $props();
</script>

<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
	{#if inherit}<button
			type="button"
			class="grid min-h-20 place-items-center rounded-lg border border-border bg-background text-xs"
			class:ring-2={value === null}
			class:ring-ring={value === null}
			aria-pressed={value === null}
			onclick={() => onselect(null)}>General</button
		>{/if}
	<button
		type="button"
		class="grid min-h-20 place-items-center rounded-lg border border-border bg-background text-xs"
		class:ring-2={inherit ? value?.kind === 'none' : value === null}
		class:ring-ring={inherit ? value?.kind === 'none' : value === null}
		aria-pressed={inherit ? value?.kind === 'none' : value === null}
		onclick={() => onselect(inherit ? { kind: 'none' } : null)}>None</button
	>
	{#each chatBackgroundTemplates as template}<button
			type="button"
			class="relative min-h-20 overflow-hidden rounded-lg border border-white/15 text-xs font-medium text-white shadow-inner"
			class:ring-2={value?.kind === 'template' && value.id === template.id}
			class:ring-ring={value?.kind === 'template' && value.id === template.id}
			aria-label={`${template.label} chat background`}
			aria-pressed={value?.kind === 'template' && value.id === template.id}
			onclick={() => onselect({ kind: 'template', id: template.id })}
			><span class="absolute inset-0 grid grid-cols-2" aria-hidden="true"
				><span
					data-mode="light"
					class="bg-cover bg-center"
					style={`background-image: ${template.light}`}
				></span
				><span
					data-mode="dark"
					class="bg-cover bg-center"
					style={`background-image: ${template.dark}`}
				></span
			></span
			><span class="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5"
				>{template.label}</span
			></button
		>{/each}
	<label
		class="chat-background-surface grid min-h-20 cursor-pointer place-items-center rounded-lg border border-dashed border-border bg-muted px-1 text-center text-xs hover:bg-accent"
		class:ring-2={value?.kind === 'custom'}
		class:ring-ring={value?.kind === 'custom'}
		style={value?.kind === 'custom' ? chatBackgroundStyle(value) : ''}
	>
		<span class={value?.kind === 'custom' ? 'rounded bg-black/55 px-1 text-white' : ''}>Upload</span>
		<input
			class="sr-only"
			type="file"
			accept="image/png,image/jpeg,image/webp"
			onchange={onupload}
		/>
	</label>
</div>
