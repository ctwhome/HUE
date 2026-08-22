<script lang="ts">
	import { ChevronRight } from 'lucide-svelte';
	import type { GlobalView } from '../GlobalNavigation.svelte';
	import type { HermesSection } from './types';
	import PreferencesView from './PreferencesView.svelte';

	let {
		sections,
		onview
	}: { sections: HermesSection[]; onview: (view: GlobalView | null) => void } = $props();
	const card = 'rounded-xl border border-border bg-card p-4';
</script>

<div class="settings-overview grid gap-6">
	<div class="settings-intro grid gap-2">
		<h2 class="text-lg font-semibold">Manage Hermes from one place</h2>
		<p class="text-muted-foreground">
			Inspect the runtime, maintain agent resources, and review integrations.
		</p>
	</div>
	<div class="settings-grid grid grid-cols-2 gap-2.5 max-[700px]:grid-cols-1">
		{#each sections as section}
			<button
				class={`${card} flex min-h-20 items-center justify-between gap-5 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring`}
				title={`Open ${section.label} settings`}
				onclick={() => onview(section.view)}
			>
				<div class="grid gap-1">
					<strong>{section.label}</strong>
					<span class="text-sm text-muted-foreground">{section.description}</span>
				</div>
				<ChevronRight class="shrink-0 text-muted-foreground" size={18} aria-hidden="true" />
			</button>
		{/each}
	</div>
	<PreferencesView />
</div>
