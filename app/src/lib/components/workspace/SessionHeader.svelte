<script lang="ts">
	import { ArrowLeft, Circle, Ellipsis, Settings2 } from 'lucide-svelte';
	import { automaticSessionIcon } from '$lib/icon';
	import InstallPinGuidance from '../pwa/InstallPinGuidance.svelte';
	import { isImageIcon } from './project-management.svelte';
	import type { HermesRuntime, Project, Session } from './types';

	let {
		project,
		session,
		branch,
		runtime,
		onsessions,
		onmanage
	}: {
		project: Project | null;
		session: Session | null;
		branch: string | null;
		runtime: HermesRuntime;
		onsessions: () => void;
		onmanage: (event: MouseEvent) => void;
	} = $props();
</script>

<header
	class="session-header flex min-h-[76px] items-center justify-between gap-2 border-b border-border px-5 py-3.5"
>
	{#if session}<button
			class="session-list-back grid size-11 shrink-0 place-items-center rounded-md"
			aria-label="Back to Sessions"
			title="Back to Sessions"
			onclick={onsessions}><ArrowLeft size={20} aria-hidden="true" /></button
		>{/if}
	<div class="min-w-0">
		<small class="desktop-session-context"
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
		<small class="mobile-session-context">{project?.name ?? 'No project'}</small>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		<div class="desktop-session-actions">
			<InstallPinGuidance projectName={project?.name} sessionTitle={session?.title} />
		</div>
		<div
			class="runtime-pill rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
			title={runtime.clarify?.reason ??
				`Clarify elicitation ${runtime.clarify?.status ?? 'unsupported'}`}
		>
			<Circle size={7} fill="currentColor" aria-hidden="true" /> Hermes ACP · Clarify {runtime
				.clarify?.status ?? 'unsupported'}
		</div>
		{#if session}<details class="session-details relative">
				<summary
					class="grid size-11 cursor-pointer place-items-center rounded-md"
					aria-label="Session details"
					title="Session details"><Ellipsis size={20} aria-hidden="true" /></summary
				>
				<div
					class="session-details-menu absolute top-[calc(100%+6px)] right-0 z-10 grid w-[min(320px,calc(100vw-24px))] gap-3 rounded-xl border border-border bg-card p-3 text-sm shadow-2xl"
				>
					<header class="flex items-center justify-between gap-2">
						<strong>Session details</strong><span class="text-xs text-muted-foreground"
							>{runtime.profile}</span
						>
					</header>
					<dl class="grid min-w-0 gap-2 text-xs">
						<div>
							<dt>Project</dt>
							<dd>{project?.name ?? 'No project'}</dd>
						</div>
						<div>
							<dt>Path</dt>
							<dd>{project?.primaryPath ?? 'Not available'}</dd>
						</div>
						{#if branch}<div>
								<dt>Branch</dt>
								<dd>{branch}</dd>
							</div>{/if}
						<div>
							<dt>Hermes ACP</dt>
							<dd>Clarify {runtime.clarify?.status ?? 'unsupported'}</dd>
						</div>
					</dl>
					<div class="grid gap-2">
						<button class="min-h-11 rounded-md border border-border px-3" onclick={onmanage}
							><Settings2 size={17} aria-hidden="true" /> Edit Session</button
						>
						<div class="mobile-install">
							<InstallPinGuidance projectName={project?.name} sessionTitle={session?.title} />
						</div>
					</div>
				</div>
			</details>{/if}
	</div>
</header>
