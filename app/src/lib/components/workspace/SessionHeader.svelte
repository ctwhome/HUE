<script lang="ts">
	import ArrowLeft from '~icons/lucide/arrow-left';
	import Bell from '~icons/lucide/bell';
	import Settings2 from '~icons/lucide/settings-2';
	import Wrench from '~icons/lucide/wrench';
	import { automaticSessionIcon } from '$lib/icon';
	import { isImageIcon } from './project-management.svelte';
	import SessionInspector from './SessionInspector.svelte';
	import type { HermesRuntime, Project, Session } from './types';

	let {
		session,
		project,
		runtime,
		delivery,
		pendingInteraction,
		contextPercent,
		projectTools,
		mobile,
		unreadNotifications,
		onsessions,
		onnotifications,
		onprojecttools,
		onicon,
		onmanage
	}: {
		session: Session | null;
		project: Project | null;
		runtime: HermesRuntime;
		delivery: string;
		pendingInteraction?: string;
		contextPercent: () => number | null;
		projectTools: boolean;
		mobile: boolean;
		unreadNotifications: number;
		onsessions: (trigger: HTMLElement) => void;
		onnotifications: () => void;
		onprojecttools: (open: boolean) => void;
		onicon: (event: MouseEvent) => void;
		onmanage: (event: MouseEvent) => void;
	} = $props();
</script>

{#if session || mobile}<header
		class="session-header flex min-h-11 items-center justify-between gap-1.5 border-b border-border px-3 py-1.5"
	>
		{#if mobile}<button
				class="session-list-back h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md"
				aria-label="Back to Sessions"
				title="Back to Sessions"
				onclick={(event) => onsessions(event.currentTarget)}
				><ArrowLeft width={20} height={20} aria-hidden="true" /></button
			>{/if}
		{#if session}<button
				class="session-icon-trigger grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
				aria-label={`Change icon for ${session.title || 'Untitled session'}`}
				title="Change session icon"
				disabled={session.pending}
				onclick={onicon}
			>
				{#if isImageIcon(session.icon ?? null)}<img
						class="title-icon size-7 rounded-lg object-cover"
						src={session.icon ?? ''}
						alt=""
					/>{:else}<span class="title-icon grid size-7 place-items-center text-lg"
						>{session.icon ?? automaticSessionIcon(session.title)}</span
					>{/if}
			</button>
			<h2 class="selected-session-title min-w-0 flex-1 truncate font-semibold">
				{session.title || 'New Hermes Session'}
			</h2>{:else}<span class="min-w-0 flex-1 font-semibold">HUE</span>{/if}
		{#if mobile}<button
				class="relative grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
				title="Notifications"
				onclick={onnotifications}
			>
				<Bell width={18} height={18} aria-hidden="true" />
				{#if unreadNotifications}<span
						class="notification-badge absolute -top-1 -right-1 min-w-5 rounded-full bg-[var(--notification)] px-1 text-[10px] leading-5 font-bold text-white"
						>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span
					>{/if}
			</button>{/if}
		{#if session && project?.rootAvailable}<button
				class="session-project-tools grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
				class:active={projectTools}
				aria-label={projectTools ? 'Back to chat' : 'Open Project tools'}
				aria-pressed={projectTools}
				title={projectTools ? 'Back to chat' : 'Project tools'}
				onclick={() => onprojecttools(!projectTools)}
				><Wrench width={18} height={18} aria-hidden="true" /></button
			>{/if}
		{#if session}<button
				class="session-settings-trigger grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
				aria-label={`Session settings for ${session.title || 'Untitled session'}`}
				title="Session settings"
				disabled={session.pending}
				onclick={onmanage}><Settings2 width={18} height={18} aria-hidden="true" /></button
			>
			<SessionInspector
				{project}
				{session}
				{runtime}
				{delivery}
				{pendingInteraction}
				contextPercent={contextPercent()}
			/>{/if}
	</header>{/if}
