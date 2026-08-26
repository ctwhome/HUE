<script lang="ts">
	import { Bell, FileText, Settings } from 'lucide-svelte';
	import BrandMark from './BrandMark.svelte';
	import Button from './ui/Button.svelte';

	export type GlobalView =
		| 'notifications'
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
		onview
	}: {
		view: GlobalView | null;
		unreadCount?: number;
		onview: (view: GlobalView | null) => void;
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
		onclick={() => onview(null)}
	><BrandMark class="global-mark size-10" /></button>
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
			aria-label="Settings"
			title="Settings"
			onclick={() => onview('settings')}><Settings aria-hidden="true" /></Button
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
