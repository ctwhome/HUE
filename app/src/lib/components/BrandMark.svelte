<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<img
	class={`size-9 shrink-0 rounded-xl border border-border bg-background object-contain drop-shadow-[0_6px_16px_rgb(0_0_0_/_0.45)] ${className}`}
	src="/favicon.png"
	alt=""
	aria-hidden="true"
/>
