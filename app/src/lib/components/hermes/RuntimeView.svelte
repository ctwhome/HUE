<script lang="ts">
	import type { HermesInfo } from './types';

	let { info }: { info: HermesInfo } = $props();
	const card = 'rounded-xl border border-border bg-card p-4';
</script>

<div class="inventory-grid grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
	{#each [['Profile', info.profile], ['Agent', info.agent ? `${info.agent.name} ${info.agent.version}` : 'Hermes ACP'], ['Protocol', `ACP v${info.protocolVersion ?? 1}`]] as item}
		<article class={`${card} grid gap-1`}>
			<small class="text-muted-foreground">{item[0]}</small><strong>{item[1]}</strong>
		</article>
	{/each}
	{#if info.capabilities}
		<details class={`${card} col-span-full`}>
			<summary class="cursor-pointer">Advertised capabilities</summary>
			<pre class="overflow-auto">{JSON.stringify(info.capabilities, null, 2)}</pre>
		</details>
	{/if}
</div>
