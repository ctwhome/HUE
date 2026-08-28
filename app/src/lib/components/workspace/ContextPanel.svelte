<script lang="ts">
	import Archive from '~icons/lucide/archive';
	import ArchiveRestore from '~icons/lucide/archive-restore';
	import ArrowLeft from '~icons/lucide/arrow-left';
	import Ban from '~icons/lucide/ban';
	import CircleCheck from '~icons/lucide/circle-check';
	import CircleHelp from '~icons/lucide/circle-help';
	import CircleX from '~icons/lucide/circle-x';
	import EllipsisVertical from '~icons/lucide/ellipsis-vertical';
	import Folder from '~icons/lucide/folder';
	import LoaderCircle from '~icons/lucide/loader-circle';
	import MessageSquare from '~icons/lucide/message-square';
	import PanelLeftClose from '~icons/lucide/panel-left-close';
	import Pin from '~icons/lucide/pin';
	import Plus from '~icons/lucide/plus';
	import Search from '~icons/lucide/search';
	import WifiOff from '~icons/lucide/wifi-off';
	import { moveBefore, prependNew, sortByOrder } from '$lib/drag-order';
	import { sessionRowState } from './session-row-state';
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
		status?:
			| 'running'
			| 'waiting-permission'
			| 'waiting-answer'
			| 'unknown'
			| 'failed'
			| 'cancelled'
			| null;
		unreadAttention?: boolean;
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
		selectedDelivery,
		selectedStatus,
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
		selectedDelivery: string;
		selectedStatus: Session['status'];
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
		isImage: (icon: string | null) => boolean;
		automaticIcon: (title?: string | null) => string;
		elapsed: (startedAt: string, now: number) => string;
	} = $props();
	let sessionOrder = $state<string[]>([]);
	let draggedSessionId = $state<string | null>(null);
	const orderedSessions = $derived(
		sortByOrder(sessions, sessionOrder, ({ sessionId }) => sessionId)
	);

	$effect(() => {
		const key = `hue:session-order:${selectedProject?.id ?? 'general'}`;
		let next: string[];
		try {
			next = prependNew(
				JSON.parse(localStorage.getItem(key) ?? '[]'),
				sessions.map(({ sessionId }) => sessionId)
			);
		} catch {
			next = sessions.map(({ sessionId }) => sessionId);
		}
		sessionOrder = next;
		localStorage.setItem(key, JSON.stringify(next));
	});

	function dragSession(event: DragEvent, session: Session) {
		if (!event.dataTransfer) return;
		if (!sessionOrder.length) sessionOrder = orderedSessions.map(({ sessionId }) => sessionId);
		draggedSessionId = session.sessionId;
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData('application/x-hue-session-id', session.sessionId);
	}

	function allowSessionDrop(event: DragEvent, session: Session) {
		const dragged = sessions.find(({ sessionId }) => sessionId === draggedSessionId);
		if (!dragged) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (dragged.sessionId === session.sessionId) return;
		const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const withoutDragged = sessionOrder.filter((sessionId) => sessionId !== dragged.sessionId);
		const targetIndex = withoutDragged.indexOf(session.sessionId);
		const before =
			event.clientY > bounds.top + bounds.height / 2
				? (withoutDragged[targetIndex + 1] ?? null)
				: session.sessionId;
		sessionOrder = moveBefore(sessionOrder, dragged.sessionId, before);
	}

	function dropSession(event: DragEvent, _session: Session) {
		event.preventDefault();
		finishSessionDrag();
	}

	function finishSessionDrag() {
		if (draggedSessionId) {
			localStorage.setItem(
				`hue:session-order:${selectedProject?.id ?? 'general'}`,
				JSON.stringify(sessionOrder)
			);
		}
		draggedSessionId = null;
	}
	const rowState = (session: Session) =>
		sessionRowState({
			...session,
			...(selectedSession?.sessionId === session.sessionId
				? {
						delivery: selectedDelivery,
						status: selectedDelivery ? selectedStatus : (selectedStatus ?? session.status)
					}
				: {})
		});
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
			onclick={onback}><ArrowLeft width={20} height={20} aria-hidden="true" /></button
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
						width={18}
						height={18}
						aria-hidden="true"
					/>{/if}{:else}<MessageSquare
					class="title-icon size-(--navigation-icon-size) shrink-0 text-muted-foreground"
					width={18}
					height={18}
					aria-hidden="true"
				/>{/if}<span class="truncate">{selectedProject?.name ?? 'Chats'}</span>
		</h1>
	</header>
	<form class="flex gap-2 border-b border-border p-2" role="search" onsubmit={onsearch}>
		<label
			class="flex min-h-(--control-height) min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2.5"
		>
			<Search width={16} height={16} aria-hidden="true" /><span class="sr-only"
				>Search Sessions</span
			><input
				class="min-w-0 flex-1 border-0 bg-transparent"
				bind:value={sessionSearch}
				type="search"
				placeholder="Search Sessions"
			/>
			{#if loading}<LoaderCircle
					width={14}
					height={14}
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
			>{#if showArchived}<ArchiveRestore width={17} height={17} aria-hidden="true" />{:else}<Archive
					width={17}
					height={17}
					aria-hidden="true"
				/>{/if}</button
		>
		{#if !mobile}<button
				class="grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				type="button"
				aria-label="Hide Sessions panel"
				title="Hide Sessions panel"
				onclick={oncollapse}><PanelLeftClose width={17} height={17} aria-hidden="true" /></button
			>{/if}
	</form>
	<div class="item-list grid gap-1 overflow-auto p-2">
		<button
			class="new-session-action sticky top-0 z-10 flex min-h-(--control-height) w-full items-center justify-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
			onclick={() => oncreate()}
			disabled={selectedProject?.rootAvailable === false}
			><Plus width={18} height={18} aria-hidden="true" /> Add new session</button
		>
		{#each orderedSessions as session (session.sessionId)}
			{@const state = rowState(session)}
			<div
				class="session-row relative w-full min-w-0"
				role="group"
				aria-label={`Session ${session.title || 'Untitled session'}`}
				ondragover={(event) => allowSessionDrop(event, session)}
				ondrop={(event) => dropSession(event, session)}
			>
				<button
					class="session-row-icon absolute top-1/2 left-0 z-1 grid h-(--control-height-icon) w-(--control-height-icon) -translate-y-1/2 place-items-center rounded-md hover:bg-accent"
					aria-label={`Change ${session.title || 'Untitled session'} icon`}
					title={`Change ${session.title || 'Untitled session'} icon`}
					disabled={session.available === false}
					onclick={(event) => onicon(event, session)}
				>
					{#if isImage(session.icon ?? null)}<img
							class="session-icon session-icon-image size-8 rounded-md object-cover"
							src={session.icon ?? ''}
							alt=""
						/>{:else}<span
							class="session-icon grid size-8 place-items-center rounded-md text-2xl leading-none"
							>{session.icon ?? automaticIcon(session.title)}</span
						>{/if}
				</button>
				<button
					class="session-select flex min-h-(--control-height) w-full cursor-grab items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1 pr-16 pl-8 text-left hover:border-border hover:bg-accent active:cursor-grabbing [&.active]:border-border [&.active]:bg-accent"
					class:active={selectedSession?.sessionId === session.sessionId}
					aria-current={selectedSession?.sessionId === session.sessionId ? 'page' : undefined}
					draggable={session.available !== false}
					ondragstart={(event) => dragSession(event, session)}
					ondragend={finishSessionDrag}
					onclick={() => onopen(session)}
				>
					<div class="session-row-copy min-w-0 flex-1">
						<div class="session-row-title flex min-w-0 items-baseline gap-2">
							<strong>{session.title || 'Untitled session'}</strong>{#if session.pinned}<Pin
									width={12}
									height={12}
									aria-label="Pinned"
								/>{/if}
							<span class="session-state shrink-0" aria-label={`Status: ${state.label}`} title={state.label}>
								{#if state.icon === 'running'}<LoaderCircle
										class="animate-spin"
										width={15}
										height={15}
										aria-hidden="true"
									/>{:else if state.icon === 'waiting'}<CircleHelp width={15} height={15} aria-hidden="true" />
								{:else if state.icon === 'failed'}<CircleX width={15} height={15} aria-hidden="true" />
								{:else if state.icon === 'cancelled'}<Ban width={15} height={15} aria-hidden="true" />
								{:else if state.icon === 'unknown'}<WifiOff width={15} height={15} aria-hidden="true" />
								{:else}<CircleCheck width={15} height={15} aria-hidden="true" />{/if}
							</span>{#if session.busySince}<span
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
									: 'New session'}{session.tags?.length
								? ` · ${session.tags.join(', ')}`
								: ''}</small
						>
					</div>
					{#if state.attention}<span
							class="session-indicator"
							class:error={session.error}
							class:attention={!session.error}
							aria-label={state.note ?? state.label}>!</span
						>
					{/if}
				</button>
				{#if !session.archived}<button
						class="session-archive absolute top-1/2 right-8 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
						aria-label={`Archive ${session.title || 'Untitled session'}`}
						title={`Archive ${session.title || 'Untitled session'}`}
						onclick={(event) => onarchive(event, session)}
						><Archive width={15} height={15} aria-hidden="true" /></button
					>{/if}
				<button
					class="session-edit absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
					aria-label={`Edit ${session.title || 'Untitled session'}`}
					title={`Edit ${session.title || 'Untitled session'}`}
					onclick={(event) => onedit(event, session)}
					><EllipsisVertical width={16} height={16} aria-hidden="true" /></button
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
