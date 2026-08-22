<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<span
	class={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-violet-700 font-black text-violet-950 shadow-[0_8px_28px_rgb(109_40_217_/_0.35)] ${className}`}
	aria-hidden="true">H</span
>
