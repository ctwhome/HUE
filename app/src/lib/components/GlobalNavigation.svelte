<script lang="ts">
	import Bell from '~icons/lucide/bell';
	import FileText from '~icons/lucide/file-text';
	import PanelLeftClose from '~icons/lucide/panel-left-close';
	import PanelLeftOpen from '~icons/lucide/panel-left-open';
	import Search from '~icons/lucide/search';
	import Settings from '~icons/lucide/settings';
	import BrandMark from './BrandMark.svelte';
	import Button from './ui/Button.svelte';

	export type GlobalView =
		| 'notifications'
		| 'app-settings'
		| 'settings'
		| 'runtime'
		| 'memory'
		| 'skills'
		| 'schedules'
		| 'commands'
		| 'profiles'
		| 'mcp'
		| 'models';

	let {
		view,
		unreadCount = 0,
		navigationCollapsed,
		onview,
		onfind,
		ontogglenavigation
	}: {
		view: GlobalView | null;
		unreadCount?: number;
		navigationCollapsed: boolean;
		onview: (view: GlobalView | null) => void;
		onfind: () => void;
		ontogglenavigation: () => void;
	} = $props();

	const action =
		'global-action text-muted-foreground [&.active]:border-ring [&.active]:bg-accent [&.active]:text-accent-foreground [&>svg]:size-4';
</script>

<nav
	class="global-rail flex min-h-0 flex-col items-center gap-2 border-r border-border bg-[var(--surface-raised)] px-2 py-3"
	aria-label="Global navigation"
>
	<button
		class={`global-home mb-1 rounded-xl focus-visible:ring-2 focus-visible:ring-ring ${view === null ? 'ring-1 ring-ring' : ''}`}
		aria-label="Workspace"
		aria-current={view === null ? 'page' : undefined}
		title="Workspace"
		onclick={() => onview(null)}><BrandMark class="global-mark size-10" /></button
	>
	<Button
		variant="outline"
		size="icon"
		class={action}
		aria-label="Find a Session"
		title="Find a Session (Cmd/Ctrl+K)"
		onclick={onfind}
	>
		<Search aria-hidden="true" />
	</Button>
	<Button
		variant="outline"
		size="icon"
		class={`${action} relative ${view === 'notifications' ? 'active' : ''}`}
		aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
		title="Notifications"
		onclick={() => onview('notifications')}
	>
		<Bell aria-hidden="true" />
		{#if unreadCount > 0}<span
				class="notification-badge absolute -top-1 -right-1 min-w-5 rounded-full bg-[var(--notification)] px-1 text-[10px] leading-5 font-bold text-white"
				>{unreadCount > 99 ? '99+' : unreadCount}</span
			>{/if}
	</Button>
	<div class="global-admin mt-auto flex flex-col gap-2">
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'settings' ? 'active' : ''}`}
			aria-label="Hermes settings"
			title="Hermes settings"
			onclick={() => onview('settings')}
			><img
				class="size-5 rounded-sm object-cover"
				src="/hermes-logo.png"
				alt=""
				aria-hidden="true"
			/></Button
		>
		<Button
			variant="outline"
			size="icon"
			class={`${action} ${view === 'app-settings' ? 'active' : ''}`}
			aria-label="App settings"
			title="App settings"
			onclick={() => onview('app-settings')}><Settings aria-hidden="true" /></Button
		>
	</div>
	<a
		class={`${action} global-docs`}
		href="/docs/"
		target="_blank"
		aria-label="Open documentation in a new tab"
		title="Documentation"><FileText aria-hidden="true" /></a
	>
	<Button
		variant="ghost"
		size="icon"
		class="global-navigation-toggle size-8 text-muted-foreground"
		aria-label={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'}
		aria-controls="project-drawer session-drawer"
		aria-expanded={!navigationCollapsed}
		title={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'}
		onclick={ontogglenavigation}
	>
		{#if navigationCollapsed}<PanelLeftOpen aria-hidden="true" />{:else}<PanelLeftClose
				aria-hidden="true"
			/>{/if}
	</Button>
</nav>
