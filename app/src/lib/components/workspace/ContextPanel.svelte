<script lang="ts">
	import { Ellipsis, LoaderCircle, Plus, X } from 'lucide-svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	type Project = {
		id: string;
		name: string;
		rootPath: string;
		icon: string | null;
		createdAt: string;
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
		sessionEmojiPickerOpen = $bindable(),
		sessionEditError,
		sessionSaving,
		now,
		oncreate,
		ontab,
		onopen,
		onedit,
		onrun,
		onworkflow,
		onimage,
		onsave,
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
		sessionEmojiPickerOpen: boolean;
		sessionEditError: string;
		sessionSaving: boolean;
		now: number;
		oncreate: () => void;
		ontab: (tab: 'sessions' | 'workflows') => void;
		onopen: (session: Session) => void;
		onedit: (event: MouseEvent, session: Session) => void;
		onrun: (workflow: Workflow) => void;
		onworkflow: (event: SubmitEvent) => void;
		onimage: (event: Event) => void;
		onsave: (event: SubmitEvent) => void;
		isImage: (icon: string | null) => boolean;
		iconPreview: () => string;
		automaticIcon: (title?: string | null) => string;
		elapsed: (startedAt: string, now: number) => string;
	} = $props();
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
			<LoaderCircle
				class={loading ? 'loading-indicator active' : 'loading-indicator'}
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
		<div class="item-list grid gap-1 overflow-auto p-2">
			{#each sessions as session}
				<div class="session-row relative">
					<button
						class="session-select flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent p-2.5 pr-10 text-left hover:border-border hover:bg-accent [&.active]:border-border [&.active]:bg-accent"
						class:active={selectedSession?.sessionId === session.sessionId}
						title={session.available === false
							? session.recovery
							: `Open ${session.title || 'Untitled session'}`}
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
								<strong>{session.title || 'Untitled session'}</strong>
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
										: 'New session'}</small
							>
						</div>
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
		<div class="item-list grid gap-1 overflow-auto p-2">
			{#each workflows as workflow}
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
	<dialog
		bind:this={editSessionDialog}
		class="add-project-dialog edit-project-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
		aria-labelledby="edit-session-icon-title"
		onclick={(event) => event.target === event.currentTarget && editSessionDialog?.close()}
	>
		<header>
			<div>
				<h2 id="edit-session-icon-title">Edit session icon</h2>
				<p>Choose an icon for {editingSession?.title || 'this session'}.</p>
			</div>
		</header>
		<form onsubmit={onsave}>
			<fieldset class="project-icon-field m-0 min-w-0 border-0 p-0">
				<legend>Session icon</legend>
				<div
					class="project-icon-editor mt-2 grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3"
				>
					<div
						class="project-icon-preview grid size-[58px] place-items-center overflow-hidden rounded-xl border border-border bg-background text-3xl"
					>
						{#if isImage(iconPreview())}<img src={iconPreview()} alt="Session icon preview" />
						{:else}<span>{iconPreview()}</span>{/if}
					</div>
					<div class="project-icon-options grid gap-2">
						<div class="project-icon-upload flex gap-1.5">
							<button
								type="button"
								aria-label="Choose session emoji"
								title="Choose session emoji"
								onclick={() => (sessionEmojiPickerOpen = !sessionEmojiPickerOpen)}
								>Choose emoji</button
							>
							<label title="Choose a custom session image">
								<span>Choose image</span>
								<input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp"
									aria-label="Session icon image"
									onchange={onimage}
								/>
							</label>
							<button
								type="button"
								title="Use automatic session icon"
								onclick={() => (sessionIcon = null)}>Automatic</button
							>
						</div>
					</div>
				</div>
				{#if sessionEmojiPickerOpen}<EmojiPicker
						onselect={(emoji) => {
							sessionIcon = emoji;
							sessionEmojiPickerOpen = false;
						}}
					/>{/if}
			</fieldset>
			{#if sessionEditError}<p class="directory-error text-sm text-destructive" role="alert">
					{sessionEditError}
				</p>{/if}
			<div class="edit-project-actions session-icon-actions flex justify-end gap-3">
				<button type="submit" title="Save icon" disabled={sessionSaving}>Save icon</button>
			</div>
		</form>
		<button
			class="icon-button grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Close session icon"
			title="Close session icon"
			onclick={() => editSessionDialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</dialog>
</aside>
