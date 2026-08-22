<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let { class: className = '', value = $bindable(), ...props }: HTMLTextareaAttributes = $props();
</script>

<textarea
	class={`min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
	bind:value
	{...props}></textarea>
