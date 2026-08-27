<script lang="ts">
	import ArrowLeft from '~icons/lucide/arrow-left';
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
		onsessions,
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
		onsessions: () => void;
		onprojecttools: (open: boolean) => void;
		onicon: (event: MouseEvent) => void;
		onmanage: (event: MouseEvent) => void;
	} = $props();
</script>

{#if session}<header
		class="session-header flex min-h-11 items-center justify-between gap-1.5 border-b border-border px-3 py-1.5"
	>
		{#if session}<button
				class="session-list-back h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md"
				aria-label="Back to Sessions"
				title="Back to Sessions"
				onclick={onsessions}><ArrowLeft width={20} height={20} aria-hidden="true" /></button
			>{/if}
		<button
			class="session-icon-trigger grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
			aria-label={`Change icon for ${session.title || 'Untitled session'}`}
			title="Change session icon"
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
		</h2>
		{#if project?.rootAvailable}<button
				class="session-project-tools grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
				class:active={projectTools}
				aria-label={projectTools ? 'Back to chat' : 'Open Project tools'}
				aria-pressed={projectTools}
				title={projectTools ? 'Back to chat' : 'Project tools'}
				onclick={() => onprojecttools(!projectTools)}
				><Wrench width={18} height={18} aria-hidden="true" /></button
			>{/if}
		<button
			class="session-settings-trigger grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
			aria-label={`Session settings for ${session.title || 'Untitled session'}`}
			title="Session settings"
			onclick={onmanage}><Settings2 width={18} height={18} aria-hidden="true" /></button
		>
		<SessionInspector
			{project}
			{session}
			{runtime}
			{delivery}
			{pendingInteraction}
			contextPercent={contextPercent()}
		/>
	</header>{/if}
