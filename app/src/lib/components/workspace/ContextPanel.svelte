<script lang="ts">
	import { ArrowLeft, Ellipsis, LoaderCircle, Pin, Play, Plus, Search, X } from 'lucide-svelte';
	type Project = {
		id: string;
		name: string;
		icon: string | null;
		primaryPath: string;
		folders: Array<{ path: string; label: string | null; isPrimary: boolean; available: boolean }>;
		rootAvailable: boolean;
	};
	type Session = {
		sessionId: string;
		cwd: string;
		title?: string | null;
		icon?: string | null;
		customIcon?: string | null;
		updatedAt?: string | null;
		busySince?: string | null;
		available?: boolean;
		recovery?: string | null;
		attention?: boolean;
		error?: boolean;
		pinned?: boolean;
		archived?: boolean;
		folder?: string | null;
		tags?: string[];
	};
	type Workflow = { id: string; name: string; prompt: string; profile: string };
	let {
		element = $bindable(),
		open,
		mobile,
		selectedProject,
		loading,
		activeTab,
		sessions,
		selectedSession,
		workflows,
		workflowName = $bindable(),
		workflowPrompt = $bindable(),
		sessionSearch = $bindable(),
		showArchived = $bindable(),
		now,
		oncreate,
		ontab,
		onopen,
		onback,
		onedit,
		onrun,
		onworkflow,
		onsearch,
		onclose,
		isImage,
		automaticIcon,
		elapsed
	}: {
		element?: HTMLElement;
		open: boolean;
		mobile: boolean;
		selectedProject: Project | null;
		loading: boolean;
		activeTab: 'sessions' | 'workflows';
		sessions: Session[];
		selectedSession: Session | null;
		workflows: Workflow[];
		workflowName: string;
		workflowPrompt: string;
		sessionSearch: string;
		showArchived: boolean;
		now: number;
		oncreate: () => void;
		ontab: (tab: 'sessions' | 'workflows') => void;
		onopen: (session: Session) => void;
		onback: () => void;
		onedit: (event: MouseEvent, session: Session) => void;
		onrun: (workflow: Workflow) => void;
		onworkflow: (event: SubmitEvent) => Promise<boolean>;
		onsearch: (event?: SubmitEvent) => void;
		onclose: () => void;
		isImage: (icon: string | null) => boolean;
		automaticIcon: (title?: string | null) => string;
		elapsed: (startedAt: string, now: number) => string;
	} = $props();
	let workflowDialog = $state<HTMLDialogElement>();

	function group(session: Session): string {
		if (session.pinned) return 'Pinned';
		if (session.archived) return 'Archived';
		if (!session.updatedAt) return 'Older';
		const days = Math.floor((Date.now() - new Date(session.updatedAt).getTime()) / 86_400_000);
		return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Older';
	}
</script>

<aside
	bind:this={element}
	id="session-drawer"
	class="context-panel flex min-h-dvh flex-col border-r border-border bg-card/95"
	class:open
	inert={mobile && !open}
	aria-hidden={mobile ? !open : undefined}
	aria-label="Project contents"
>
	<header>
		<button
			class="session-projects-back grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent"
			data-drawer-focus
			aria-label="Back to Projects"
			title="Back to Projects"
			onclick={onback}><ArrowLeft size={20} aria-hidden="true" /></button
		>
		<div>
			<small>Session scope</small>
			<h1 class="selected-project-title mt-1 flex items-center gap-2 font-semibold">
				{#if selectedProject?.icon}{#if isImage(selectedProject.icon)}<img
							class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
							src={selectedProject.icon}
							alt=""
						/>
					{:else}<span
							class="title-icon grid size-6 shrink-0 place-items-center rounded-md object-cover"
							>{selectedProject.icon}</span
						>{/if}{/if}<span>{selectedProject?.name ?? 'No project'}</span>
			</h1>
		</div>
		<div class="context-actions flex items-center gap-2">
			<LoaderCircle
				class={loading ? 'loading-indicator active animate-spin' : 'loading-indicator'}
				role="status"
				aria-label="Loading project contents"
				aria-hidden={!loading}
			/>
			{#if activeTab === 'sessions'}<button
					class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
					onclick={oncreate}
					aria-label="New session"
					title="New session"
					disabled={selectedProject?.rootAvailable === false}
					><Plus size={18} aria-hidden="true" /></button
				>{/if}
		</div>
		{#if mobile}<button
				class="drawer-close grid size-11 shrink-0 place-items-center rounded-md"
				aria-label="Close Sessions"
				title="Close Sessions"
				onclick={onclose}><X size={20} aria-hidden="true" /></button
			>{/if}
	</header>
	<div class="tabs grid grid-cols-2 gap-1 border-b border-border px-3.5 py-2.5" role="tablist">
		<button
			role="tab"
			aria-selected={activeTab === 'sessions'}
			title="Sessions"
			class:active={activeTab === 'sessions'}
			onclick={() => ontab('sessions')}>Sessions</button
		>
		{#if selectedProject?.rootAvailable}<button
				title="Workflows"
				role="tab"
				aria-selected={activeTab === 'workflows'}
				class:active={activeTab === 'workflows'}
				onclick={() => ontab('workflows')}>Workflows</button
			>{/if}
	</div>
	{#if activeTab === 'sessions'}
		<form class="flex gap-2 border-b border-border p-2" role="search" onsubmit={onsearch}>
			<label
				class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3"
			>
				<Search size={16} aria-hidden="true" /><span class="sr-only">Search Sessions</span><input
					class="min-w-0 flex-1 border-0 bg-transparent"
					bind:value={sessionSearch}
					type="search"
					placeholder="Search Sessions"
				/>
			</label>
			<button class="min-h-11 px-3" type="submit" title="Search Sessions">Search</button>
		</form>
		<label class="flex min-h-11 items-center gap-2 border-b border-border px-3 text-sm"
			><input bind:checked={showArchived} onchange={() => onsearch()} type="checkbox" /> Show archived</label
		>
		<div class="item-list grid gap-1 overflow-auto p-2">
			{#each sessions as session, index (session.sessionId)}
				{#if index === 0 || group(sessions[index - 1]) !== group(session)}<h2
						class="px-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
					>
						{group(session)}
					</h2>{/if}
				<div class="session-row relative">
					<button
						class="session-select flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent p-2.5 pr-10 text-left hover:border-border hover:bg-accent [&.active]:border-border [&.active]:bg-accent"
						class:active={selectedSession?.sessionId === session.sessionId}
						aria-current={selectedSession?.sessionId === session.sessionId ? 'page' : undefined}
						title={session.available === false
							? session.recovery
							: `${session.error ? 'Failed — ' : session.attention ? 'Needs attention — ' : ''}Open ${session.title || 'Untitled session'}`}
						disabled={session.available === false}
						onclick={() => onopen(session)}
					>
						{#if isImage(session.icon ?? null)}<img
								class="session-icon session-icon-image size-7 shrink-0 rounded-lg object-cover"
								src={session.icon ?? ''}
								alt=""
							/>
						{:else}<span class="session-icon grid size-7 shrink-0 place-items-center rounded-lg"
								>{session.icon ?? automaticIcon(session.title)}</span
							>{/if}
						<div class="session-row-copy min-w-0 flex-1">
							<div class="session-row-title flex items-baseline gap-2">
								<strong>{session.title || 'Untitled session'}</strong>{#if session.pinned}<Pin
										size={12}
										aria-label="Pinned"
									/>{/if}
								{#if session.busySince}<span
										class="busy-timer text-xs whitespace-nowrap text-sky-400 tabular-nums"
										aria-label={`Busy for ${elapsed(session.busySince, now)}`}
										>{elapsed(session.busySince, now)}</span
									>{/if}
							</div>
							<small class:text-amber-400={session.available === false}
								>{session.updatedAt
									? new Date(session.updatedAt).toLocaleString()
									: session.available === false
										? session.recovery
										: 'New session'}{session.folder ? ` · ${session.folder}` : ''}{session.tags
									?.length
									? ` · ${session.tags.join(', ')}`
									: ''}</small
							>
						</div>
						{#if session.error}<span class="session-indicator error" aria-label="Session failed"
								>!</span
							>
						{:else if session.attention}<span
								class="session-indicator attention"
								aria-label="Session needs attention">•</span
							>{/if}
					</button>
					{#if session.available !== false}<button
							class="session-edit absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
							aria-label={`Edit ${session.title || 'Untitled session'}`}
							title={`Edit ${session.title || 'Untitled session'}`}
							onclick={(event) => onedit(event, session)}
							><Ellipsis size={16} aria-hidden="true" /></button
						>{/if}
				</div>
			{/each}
			{#if !loading && sessions.length === 0}<p
					class="empty p-4 text-center text-sm text-muted-foreground"
				>
					No persisted Hermes Sessions yet.
				</p>{/if}
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2 border-b border-border p-3">
			<p class="text-xs text-muted-foreground">
				A Workflow is a reusable Hermes prompt scoped to this Project.
			</p>
			<button
				class="min-h-11 shrink-0 rounded-md bg-primary px-3 text-primary-foreground"
				onclick={() => workflowDialog?.showModal()}
			>
				<Plus size={17} aria-hidden="true" /> New workflow
			</button>
		</div>
		<div class="item-list grid gap-1 overflow-auto p-2">
			{#each workflows as workflow (workflow.id)}
				<article
					class="workflow-card flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
				>
					<div class="min-w-0">
						<strong>{workflow.name}</strong>
						<p>{workflow.prompt}</p>
						<small>Project workflow · {workflow.profile || 'default'} profile</small>
					</div>
					<button
						aria-label={`Run ${workflow.name}`}
						title={`Run ${workflow.name}`}
						onclick={() => onrun(workflow)}><Play size={16} aria-hidden="true" /> Run</button
					>
				</article>
			{/each}
			{#if !loading && workflows.length === 0}<div
					class="empty grid justify-items-center gap-2 p-5 text-center text-sm text-muted-foreground"
				>
					<Play size={24} aria-hidden="true" />
					<strong class="text-foreground">No workflows yet</strong>
					<p>Save a prompt you run often. Run creates and opens a new Session.</p>
				</div>{/if}
		</div>
		<dialog
			bind:this={workflowDialog}
			class="add-project-dialog workflow-dialog"
			aria-labelledby="workflow-dialog-title"
			onclick={(event) => event.target === event.currentTarget && workflowDialog?.close()}
		>
			<header class="dialog-header">
				<div>
					<h2 id="workflow-dialog-title">New workflow</h2>
					<p>Run creates and opens a new Session.</p>
				</div>
				<button
					class="icon-button"
					aria-label="Close workflow editor"
					title="Close workflow editor"
					onclick={() => workflowDialog?.close()}><X size={18} aria-hidden="true" /></button
				>
			</header>
			<form
				class="workflow-form"
				onsubmit={async (event) => {
					if (await onworkflow(event)) workflowDialog?.close();
				}}
			>
				<div class="dialog-body">
					<input
						bind:value={workflowName}
						placeholder="Workflow name"
						aria-label="Workflow name"
						required
					/><textarea
						bind:value={workflowPrompt}
						placeholder="Reusable Hermes prompt"
						aria-label="Workflow prompt"
						required></textarea>
				</div>
				<footer class="dialog-footer">
					<button type="button" onclick={() => workflowDialog?.close()}>Cancel</button><button
						type="submit"
						title="Save workflow">Save workflow</button
					>
				</footer>
			</form>
		</dialog>
	{/if}
</aside>
