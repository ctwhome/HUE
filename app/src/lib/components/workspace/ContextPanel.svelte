<script lang="ts">
	import { Archive, Ellipsis, LoaderCircle, Pin, Plus, Search } from 'lucide-svelte';
	import SessionManagerDialog from './SessionManagerDialog.svelte';
	import type { WorkMode } from '$lib/work-mode';
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
		workMode?: WorkMode;
	};
	type Workflow = { id: string; name: string; prompt: string; profile: string };
	let {
		open,
		selectedProject,
		loading,
		activeTab,
		sessions,
		selectedSession,
		workflows,
		workflowName = $bindable(),
		workflowPrompt = $bindable(),
		editSessionDialog = $bindable(),
		editingSession,
		sessionIcon = $bindable(),
		sessionTitle = $bindable(),
		sessionPinned = $bindable(),
		sessionArchived = $bindable(),
		sessionFolder = $bindable(),
		sessionTags = $bindable(),
		sessionSearch = $bindable(),
		showArchived = $bindable(),
		sessionEmojiPickerOpen = $bindable(),
		sessionEditError,
		sessionSaving,
		archivingSessionId,
		now,
		oncreate,
		ontab,
		onopen,
		onarchive,
		onedit,
		onrun,
		onworkflow,
		onimage,
		onsave,
		onsearch,
		onduplicate,
		ondelete,
		onexport,
		isImage,
		iconPreview,
		automaticIcon,
		elapsed
	}: {
		open: boolean;
		selectedProject: Project | null;
		loading: boolean;
		activeTab: 'sessions' | 'workflows';
		sessions: Session[];
		selectedSession: Session | null;
		workflows: Workflow[];
		workflowName: string;
		workflowPrompt: string;
		editSessionDialog?: HTMLDialogElement;
		editingSession: Session | null;
		sessionIcon: string | null;
		sessionTitle: string;
		sessionPinned: boolean;
		sessionArchived: boolean;
		sessionFolder: string;
		sessionTags: string;
		sessionSearch: string;
		showArchived: boolean;
		sessionEmojiPickerOpen: boolean;
		sessionEditError: string;
		sessionSaving: boolean;
		archivingSessionId: string | null;
		now: number;
		oncreate: () => void;
		ontab: (tab: 'sessions' | 'workflows') => void;
		onopen: (session: Session) => void;
		onarchive: (event: MouseEvent, session: Session) => void;
		onedit: (event: MouseEvent, session: Session) => void;
		onrun: (workflow: Workflow) => void;
		onworkflow: (event: SubmitEvent) => void;
		onimage: (event: Event) => void;
		onsave: (event: SubmitEvent) => void;
		onsearch: (event?: SubmitEvent) => void;
		onduplicate: () => void;
		ondelete: () => void;
		onexport: (format: 'markdown' | 'json') => void;
		isImage: (icon: string | null) => boolean;
		iconPreview: () => string;
		automaticIcon: (title?: string | null) => string;
		elapsed: (startedAt: string, now: number) => string;
	} = $props();

	function group(session: Session): string {
		if (session.pinned) return 'Pinned';
		if (session.archived) return 'Archived';
		if (!session.updatedAt) return 'Older';
		const days = Math.floor((Date.now() - new Date(session.updatedAt).getTime()) / 86_400_000);
		return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Older';
	}
</script>

<aside
	id="session-drawer"
	class="context-panel flex min-h-dvh flex-col border-r border-border bg-card/95"
	class:open
	aria-label="Project contents"
>
	<header>
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
			{#if loading}<LoaderCircle
					class="loading-indicator animate-spin"
					role="status"
					aria-label="Loading project contents"
				/>
			{/if}
			{#if activeTab === 'sessions'}<button
					class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
					onclick={oncreate}
					aria-label="New session"
					title="New session"
					disabled={selectedProject?.rootAvailable === false}
					><Plus size={18} aria-hidden="true" /></button
				>{/if}
		</div>
	</header>
	<div class="tabs grid grid-cols-2 gap-1 border-b border-border px-3.5 py-2.5" role="tablist">
		<button
			title="Sessions"
			class:active={activeTab === 'sessions'}
			onclick={() => ontab('sessions')}>Sessions</button
		>
		{#if selectedProject?.rootAvailable}<button
				title="Workflows"
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
						class="session-select flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent p-2.5 pr-[4.5rem] text-left hover:border-border hover:bg-accent [&.active]:border-border [&.active]:bg-accent"
						class:active={selectedSession?.sessionId === session.sessionId}
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
					{#if session.available !== false}<div
							class="session-actions absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
						>
							{#if !session.archived}<button
									class="session-archive grid size-7 place-items-center rounded-md hover:bg-accent"
									aria-label={`Archive ${session.title || 'Untitled session'}`}
									title={`Archive ${session.title || 'Untitled session'}`}
									disabled={archivingSessionId === session.sessionId}
									onclick={(event) => onarchive(event, session)}
									><Archive size={16} aria-hidden="true" /></button
								>{/if}
							<button
								class="session-edit grid size-7 place-items-center rounded-md hover:bg-accent"
								aria-label={`Edit ${session.title || 'Untitled session'}`}
								title={`Edit ${session.title || 'Untitled session'}`}
								onclick={(event) => onedit(event, session)}
								><Ellipsis size={16} aria-hidden="true" /></button
							>
						</div>{/if}
				</div>
			{/each}
			{#if !loading && sessions.length === 0}<p
					class="empty p-4 text-center text-sm text-muted-foreground"
				>
					No persisted Hermes Sessions yet.
				</p>{/if}
		</div>
	{:else}
		<div class="item-list grid gap-1 overflow-auto p-2">
			{#each workflows as workflow (workflow.id)}
				<article
					class="workflow-card flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
				>
					<div>
						<strong>{workflow.name}</strong>
						<p>{workflow.prompt}</p>
					</div>
					<button title={`Run ${workflow.name}`} onclick={() => onrun(workflow)}>Run</button>
				</article>
			{/each}
		</div>
		<form class="workflow-form mt-auto grid gap-2 border-t border-border p-3" onsubmit={onworkflow}>
			<input bind:value={workflowName} placeholder="Workflow name" aria-label="Workflow name" />
			<textarea
				bind:value={workflowPrompt}
				placeholder="Reusable Hermes prompt"
				aria-label="Workflow prompt"></textarea>
			<button type="submit" title="Save workflow">Save workflow</button>
		</form>
	{/if}
	<SessionManagerDialog
		bind:dialog={editSessionDialog}
		bind:title={sessionTitle}
		bind:pinned={sessionPinned}
		bind:archived={sessionArchived}
		bind:folder={sessionFolder}
		bind:tags={sessionTags}
		bind:icon={sessionIcon}
		bind:emojiOpen={sessionEmojiPickerOpen}
		error={sessionEditError}
		saving={sessionSaving}
		{onimage}
		{onsave}
		{onduplicate}
		{ondelete}
		{onexport}
		{isImage}
		{iconPreview}
	/>
</aside>
