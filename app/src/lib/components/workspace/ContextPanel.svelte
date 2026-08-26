<script lang="ts">
	import {
		Archive,
		ArchiveRestore,
		ArrowLeft,
		Ellipsis,
		Folder,
		LoaderCircle,
		PanelLeftClose,
		Pin,
		Plus,
		Search,
		X
	} from 'lucide-svelte';
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
	let {
		element = $bindable(),
		open,
		mobile,
		selectedProject,
		loading,
		sessions,
		selectedSession,
		sessionSearch = $bindable(),
		showArchived = $bindable(),
		now,
		oncreate,
		onopen,
		onback,
		onedit,
		onicon,
		onarchive,
		onsearch,
		oncollapse,
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
		sessions: Session[];
		selectedSession: Session | null;
		sessionSearch: string;
		showArchived: boolean;
		now: number;
		oncreate: () => void;
		onopen: (session: Session) => void;
		onback: () => void;
		onedit: (event: MouseEvent, session: Session) => void;
		onicon: (event: MouseEvent, session: Session) => void;
		onarchive: (event: MouseEvent, session: Session) => void;
		onsearch: (event?: SubmitEvent) => void;
		oncollapse: () => void;
		onclose: () => void;
		isImage: (icon: string | null) => boolean;
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
	function dragSession(event: DragEvent, session: Session) {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData('application/x-hue-session-id', session.sessionId);
	}
</script>

<aside
	bind:this={element}
	id="session-drawer"
	class="context-panel flex min-h-0 flex-col border-r border-border bg-card/95"
	class:open
	inert={mobile && !open}
	aria-hidden={mobile ? !open : undefined}
	aria-label="Project contents"
>
	<header class="project-context-header">
		<button
			class="session-projects-back grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent"
			data-drawer-focus
			aria-label="Back to Projects"
			title="Back to Projects"
			onclick={onback}><ArrowLeft size={20} aria-hidden="true" /></button
		>
		<h1 class="selected-project-title flex min-w-0 flex-1 items-center gap-2 font-semibold">
			{#if selectedProject}{#if isImage(selectedProject.icon)}<img
						class="title-icon grid size-(--navigation-icon-size) shrink-0 place-items-center rounded-md object-cover"
						src={selectedProject.icon ?? ''}
						alt=""
					/>
				{:else if selectedProject.icon}<span
						class="title-icon grid size-(--navigation-icon-size) shrink-0 place-items-center rounded-md object-cover"
						>{selectedProject.icon}</span
					>{:else}<Folder
						class="title-icon project-icon-default size-(--navigation-icon-size) shrink-0 text-muted-foreground"
						size={18}
						aria-hidden="true"
					/>{/if}{/if}<span class="truncate">{selectedProject?.name ?? 'No project'}</span>
		</h1>
		{#if mobile}<button
				class="drawer-close grid size-11 shrink-0 place-items-center rounded-md"
				aria-label="Close Sessions"
				title="Close Sessions"
				onclick={onclose}><X size={20} aria-hidden="true" /></button
			>{/if}
	</header>
	<form class="flex gap-2 border-b border-border p-2" role="search" onsubmit={onsearch}>
		<label
			class="flex min-h-(--control-height) min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2.5"
		>
			<Search size={16} aria-hidden="true" /><span class="sr-only">Search Sessions</span><input
				class="min-w-0 flex-1 border-0 bg-transparent"
				bind:value={sessionSearch}
				type="search"
				placeholder="Search Sessions"
			/>
			{#if loading}<LoaderCircle
					size={14}
					class="loading-indicator active shrink-0 animate-spin"
					role="status"
					aria-label="Loading project contents"
				/>{/if}
		</label>
		<button
			class="grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border hover:bg-accent"
			class:bg-accent={showArchived}
			type="button"
			aria-pressed={showArchived}
			aria-label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
			title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
			onclick={() => {
				showArchived = !showArchived;
				onsearch();
			}}
			>{#if showArchived}<ArchiveRestore size={17} aria-hidden="true" />{:else}<Archive
					size={17}
					aria-hidden="true"
				/>{/if}</button
		>
		{#if !mobile}<button
				class="grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				type="button"
				aria-label="Hide Sessions panel"
				title="Hide Sessions panel"
				onclick={oncollapse}><PanelLeftClose size={17} aria-hidden="true" /></button
			>{/if}
	</form>
	<div class="item-list grid gap-1 overflow-auto p-2">
		<button
			class="new-session-action sticky top-0 z-10 flex min-h-(--control-height) w-full items-center justify-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
			onclick={oncreate}
			disabled={selectedProject?.rootAvailable === false}
			><Plus size={18} aria-hidden="true" /> Add new session</button
		>
		{#each sessions as session, index (session.sessionId)}
			{#if index === 0 || group(sessions[index - 1]) !== group(session)}<h2
					class="px-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
				>
					{group(session)}
				</h2>{/if}
			<div class="session-row relative w-full min-w-0">
				<button
					class="session-row-icon absolute top-1/2 left-0 z-1 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md hover:bg-accent"
					aria-label={`Change ${session.title || 'Untitled session'} icon`}
					title={`Change ${session.title || 'Untitled session'} icon`}
					disabled={session.available === false}
					onclick={(event) => onicon(event, session)}
				>
					{#if isImage(session.icon ?? null)}<img
							class="session-icon session-icon-image size-(--navigation-icon-size) rounded-md object-cover"
							src={session.icon ?? ''}
							alt=""
						/>{:else}<span
							class="session-icon grid size-(--navigation-icon-size) place-items-center rounded-md"
							>{session.icon ?? automaticIcon(session.title)}</span
						>{/if}
				</button>
				<button
					class="session-select flex min-h-(--control-height) w-full items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1 pr-16 pl-8 text-left hover:border-border hover:bg-accent [&.active]:border-border [&.active]:bg-accent"
					draggable={session.available !== false}
					class:active={selectedSession?.sessionId === session.sessionId}
					aria-current={selectedSession?.sessionId === session.sessionId ? 'page' : undefined}
					title={session.available === false ? session.recovery : undefined}
					disabled={session.available === false}
					ondragstart={(event) => dragSession(event, session)}
					onclick={() => onopen(session)}
				>
					<div class="session-row-copy min-w-0 flex-1">
						<div class="session-row-title flex min-w-0 items-baseline gap-2">
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
				{#if !session.archived}<button
						class="session-archive absolute top-1/2 right-8 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
						aria-label={`Archive ${session.title || 'Untitled session'}`}
						title={`Archive ${session.title || 'Untitled session'}`}
						onclick={(event) => onarchive(event, session)}
						><Archive size={15} aria-hidden="true" /></button
					>{/if}
				<button
					class="session-edit absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
					aria-label={`Edit ${session.title || 'Untitled session'}`}
					title={`Edit ${session.title || 'Untitled session'}`}
					onclick={(event) => onedit(event, session)}
					><Ellipsis size={16} aria-hidden="true" /></button
				>
			</div>
		{/each}
		{#if !loading && sessions.length === 0}<p
				class="empty p-4 text-center text-sm text-muted-foreground"
			>
				No persisted Hermes Sessions yet.
			</p>{/if}
	</div>
</aside>
