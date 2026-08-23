<script lang="ts">
	import { Circle } from 'lucide-svelte';
	import { automaticSessionIcon } from '$lib/icon';
	import InstallPinGuidance from '../pwa/InstallPinGuidance.svelte';
	import { isImageIcon } from './project-management.svelte';
	import type { HermesRuntime, Project, Session } from './types';

	let {
		project,
		session,
		branch,
		runtime
	}: {
		project: Project | null;
		session: Session | null;
		branch: string | null;
		runtime: HermesRuntime;
	} = $props();
</script>

<header
	class="session-header flex min-h-[76px] items-center justify-between gap-2 border-b border-border px-5 py-3.5"
>
	<div class="min-w-0">
		<small
			>{project?.primaryPath ?? 'No project'}
			{#if branch}<span class="header-branch">{branch}</span>{/if}</small
		>
		<h2 class="selected-session-title mt-1 flex items-center gap-2 font-semibold">
			{#if session}{#if isImageIcon(session.icon ?? null)}<img
						class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
						src={session.icon ?? ''}
						alt=""
					/>{:else}<span
						class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
						>{session.icon ?? automaticSessionIcon(session.title)}</span
					>{/if}{/if}
			<span class="truncate"
				>{session?.title ||
					(session
						? 'New Hermes Session'
						: project
							? 'Project workbench'
							: 'Projects · Workflows · Sessions')}</span
			>
		</h2>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		<InstallPinGuidance projectName={project?.name} sessionTitle={session?.title} />
		<div
			class="runtime-pill rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
			title={runtime.clarify?.reason ??
				`Clarify elicitation ${runtime.clarify?.status ?? 'unsupported'}`}
		>
			<Circle size={7} fill="currentColor" aria-hidden="true" /> Hermes ACP · Clarify {runtime
				.clarify?.status ?? 'unsupported'}
		</div>
	</div>
</header>
