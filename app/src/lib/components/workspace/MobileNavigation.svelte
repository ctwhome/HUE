<script lang="ts">
	import Bell from '~icons/lucide/bell';
	import FolderKanban from '~icons/lucide/folder-kanban';
	import Menu from '~icons/lucide/menu';
	import MessageSquare from '~icons/lucide/message-square';
	import MessagesSquare from '~icons/lucide/messages-square';
	import type { MobilePane } from './mobile-navigation';
	import type { Project, Session } from './types';

	let {
		drawer,
		ready,
		backdrop,
		unreadCount,
		project,
		session,
		view,
		ontoggle,
		onclose,
		onnotifications,
		onsettings
	} = $props<{
		drawer: MobilePane;
		ready: boolean;
		backdrop: boolean;
		unreadCount: number;
		project: Project | null;
		session: Session | null;
		view: string | null;
		ontoggle: (pane: Exclude<MobilePane, null>, trigger: HTMLElement) => void;
		onclose: () => void;
		onnotifications: () => void;
		onsettings: () => void;
	}>();
</script>

<nav class="mobile-navigation" aria-label="Workspace navigation">
	<button
		class="project-switcher"
		aria-controls="project-drawer"
		aria-expanded={drawer === 'projects'}
		aria-current={drawer === 'projects' ? 'page' : undefined}
		aria-label={`Projects, current ${project?.name ?? 'Chats'}`}
		title="Switch Project"
		disabled={!ready}
		onclick={(event) => ontoggle('projects', event.currentTarget)}
		>{#if project}<FolderKanban width={19} height={19} aria-hidden="true" />{:else}<MessageSquare
				width={19}
				height={19}
				aria-hidden="true"
			/>{/if}<span>{project?.name ?? 'Chats'}</span></button
	>
	<button
		aria-controls="session-drawer"
		aria-expanded={drawer === 'sessions'}
		aria-current={drawer === 'sessions' ? 'page' : undefined}
		aria-label="Sessions"
		title="Sessions"
		disabled={!ready}
		onclick={(event) => ontoggle('sessions', event.currentTarget)}
		><MessagesSquare width={19} height={19} aria-hidden="true" /><span>Sessions</span></button
	>
	<button
		class="mobile-icon-action"
		aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
		aria-current={view === 'notifications' ? 'page' : undefined}
		title="Notifications"
		onclick={onnotifications}
		><Bell width={20} height={20} aria-hidden="true" />{#if unreadCount}<span
				class="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span
			>{/if}</button
	>
	<button
		class="mobile-icon-action"
		aria-label="App settings"
		aria-current={view === 'app-settings' ? 'page' : undefined}
		title="App settings"
		onclick={onsettings}
		><Menu width={20} height={20} aria-hidden="true" /><span class="sr-only">App settings</span
		></button
	>
</nav>
{#if backdrop}<button
		class="drawer-backdrop"
		aria-label="Close navigation"
		title="Close navigation"
		onclick={onclose}
	></button>{/if}
