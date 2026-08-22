<script lang="ts">
	import type { Command, McpServer, Profile } from './types';

	let {
		view,
		commands,
		profiles,
		servers,
		oncommand = () => undefined
	}: {
		view: 'commands' | 'profiles' | 'mcp';
		commands: Command[];
		profiles: Profile[];
		servers: McpServer[];
		oncommand?: (command: Command) => void;
	} = $props();
	const card = 'rounded-xl border border-border bg-card p-4';
</script>

{#if view === 'profiles'}
	<div class="inventory-grid grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
		{#each profiles as profile}
			<article class={`${card} grid gap-1`}>
				<small class="text-muted-foreground"
					>{profile.active ? 'Next-launch default' : 'Profile'}</small
				>
				<strong>{profile.name}</strong>
				<p class="text-sm text-muted-foreground">{profile.model} · Gateway {profile.gateway}</p>
			</article>
		{/each}
	</div>
{:else if view === 'mcp'}
	<div class="inventory-list grid gap-2">
		{#each servers as server}
			<article class={`${card} flex items-center justify-between gap-4`}>
				<div class="grid gap-1">
					<strong>{server.name}</strong>
					<small class="text-muted-foreground"
						>{server.command || server.url || server.transport}</small
					>
				</div>
				<span
					class={`rounded-full px-2 py-1 text-xs ${server.enabled ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}
					>{server.enabled ? 'enabled' : 'disabled'}</span
				>
			</article>
		{/each}
		{#if !servers.length}<p class="muted text-muted-foreground">No MCP servers configured.</p>{/if}
	</div>
{:else if commands.length}
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
