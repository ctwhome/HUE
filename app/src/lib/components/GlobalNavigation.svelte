<script lang="ts">
	import {
		CalendarDays,
		Code2,
		FileText,
		Grid2X2,
		MessageSquare,
		Plug,
		Settings,
		SlidersHorizontal,
		UserRound
	} from 'lucide-svelte';
	import BrandMark from './BrandMark.svelte';
	import Button from './ui/Button.svelte';

	export type GlobalView =
		'settings' | 'runtime' | 'skills' | 'schedules' | 'commands' | 'profiles' | 'mcp';

	let { view, onview }: { view: GlobalView | null; onview: (view: GlobalView | null) => void } =
		$props();

	const action =
		'global-action size-10 text-muted-foreground [&.active]:border-orange-900 [&.active]:bg-orange-950 [&.active]:text-orange-300 [&>svg]:size-5';
</script>

<nav
	class="global-rail flex min-h-0 flex-col items-center gap-3 border-r border-border bg-background/95 px-2 py-4"
	aria-label="Global navigation"
>
	<BrandMark class="global-mark mb-2 size-10" />
	<Button
		variant="outline"
		size="icon"
		class={`${action} ${view === null ? 'active' : ''}`}
		aria-label="Workspace"
		aria-current={view === null ? 'page' : undefined}
		title="Workspace"
		onclick={() => onview(null)}
	>
		<MessageSquare aria-hidden="true" />
	</Button>
	<div class="global-admin mt-auto flex flex-col gap-3">
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'settings' ? 'active' : ''}`}
			aria-label="Settings"
			title="Settings"
			onclick={() => onview('settings')}><Settings aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} runtime-inspector-button ${view === 'runtime' ? 'active' : ''}`}
			aria-label="Inspect Hermes runtime"
			title="Hermes runtime"
			onclick={() => onview('runtime')}><SlidersHorizontal aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'schedules' ? 'active' : ''}`}
			aria-label="Schedules"
			title="Schedules"
			onclick={() => onview('schedules')}><CalendarDays aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'skills' ? 'active' : ''}`}
			aria-label="Skills"
			title="Skills"
			onclick={() => onview('skills')}><Grid2X2 aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'commands' ? 'active' : ''}`}
			aria-label="Commands"
			title="Session commands"
			onclick={() => onview('commands')}><Code2 aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'profiles' ? 'active' : ''}`}
			aria-label="Profiles"
			title="Profiles"
			onclick={() => onview('profiles')}><UserRound aria-hidden="true" /></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'mcp' ? 'active' : ''}`}
			aria-label="MCP"
			title="MCP servers"
			onclick={() => onview('mcp')}><Plug aria-hidden="true" /></Button
		>
	</div>
	<a
		class={`${action} global-docs`}
		href="/docs/"
		target="_blank"
		aria-label="Open documentation in a new tab"
		title="Documentation"><FileText aria-hidden="true" /></a
	>
</nav>
