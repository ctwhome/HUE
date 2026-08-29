<script lang="ts">
	import type { Command } from './types';

	let {
		commands,
		oncommand = () => undefined
	}: {
		commands: Command[];
		oncommand?: (command: Command) => void;
	} = $props();
	const card = 'rounded-xl border border-border bg-card p-4';
</script>

{#if commands.length}
	<div class="inventory-list grid gap-2">
		{#each commands as command}
			<button
				class={`${card} grid min-h-11 gap-1 text-left hover:bg-accent`}
				title={`Run /${command.name}`}
				onclick={() => oncommand(command)}
			>
				<strong>/{command.name}</strong>
				<small class="text-muted-foreground">{command.description}</small>
			</button>
		{/each}
	</div>
{:else}
	<p class="muted text-muted-foreground">Open a Hermes Session to load its advertised commands.</p>
{/if}
