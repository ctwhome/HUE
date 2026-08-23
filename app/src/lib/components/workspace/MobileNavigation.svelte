<script lang="ts">
	import type { MobilePane } from './mobile-navigation';

	let { drawer, ready, backdrop, ontoggle, onclose, onsettings } = $props<{
		drawer: MobilePane;
		ready: boolean;
		backdrop: boolean;
		ontoggle: (pane: Exclude<MobilePane, null>, trigger: HTMLElement) => void;
		onclose: () => void;
		onsettings: () => void;
	}>();
</script>

<nav class="mobile-navigation" aria-label="Workspace navigation">
	{#each ['projects', 'sessions'] as pane}
		<button
			aria-controls={`${pane === 'projects' ? 'project' : 'session'}-drawer`}
			aria-expanded={drawer === pane}
			title={pane === 'projects' ? 'Projects' : 'Sessions'}
			disabled={!ready}
			onclick={(event) => ontoggle(pane as Exclude<MobilePane, null>, event.currentTarget)}
			>{pane === 'projects' ? 'Projects' : 'Sessions'}</button
		>
	{/each}
	<button aria-label="Settings" title="Settings" onclick={onsettings}>Settings</button>
</nav>
{#if backdrop}<button
		class="drawer-backdrop"
		aria-label="Close navigation"
		title="Close navigation"
		onclick={onclose}
	></button>{/if}
