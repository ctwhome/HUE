<script lang="ts">
	import { ArrowLeft, Ellipsis } from 'lucide-svelte';
	import { automaticSessionIcon } from '$lib/icon';
	import { isImageIcon } from './project-management.svelte';
	import type { Session } from './types';

	let {
		session,
		onsessions,
		onicon,
		onmanage
	}: {
		session: Session | null;
		onsessions: () => void;
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
				onclick={onsessions}><ArrowLeft size={20} aria-hidden="true" /></button
			>{/if}
		<button
			class="session-icon-trigger grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
			aria-label={`Manage ${session.title || 'Untitled session'}`}
			title="Session options"
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
		<button
			class="grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
			aria-label={`Session options for ${session.title || 'Untitled session'}`}
			title="Session options"
			onclick={onmanage}><Ellipsis size={20} aria-hidden="true" /></button
		>
	</header>{/if}
