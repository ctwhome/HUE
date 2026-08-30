<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Archive from '~icons/lucide/archive';
	import ArchiveRestore from '~icons/lucide/archive-restore';
	import ArchiveX from '~icons/lucide/archive-x';
	import ArrowLeft from '~icons/lucide/arrow-left';
	import Ban from '~icons/lucide/ban';
	import CalendarClock from '~icons/lucide/calendar-clock';
	import CircleCheck from '~icons/lucide/circle-check';
	import CircleHelp from '~icons/lucide/circle-help';
	import CircleX from '~icons/lucide/circle-x';
	import EllipsisVertical from '~icons/lucide/ellipsis-vertical';
	import Folder from '~icons/lucide/folder';
	import LoaderCircle from '~icons/lucide/loader-circle';
	import MessageSquare from '~icons/lucide/message-square';
	import Pencil from '~icons/lucide/pencil';
	import Pin from '~icons/lucide/pin';
	import Plus from '~icons/lucide/plus';
	import Search from '~icons/lucide/search';
	import Trash2 from '~icons/lucide/trash-2';
	import WifiOff from '~icons/lucide/wifi-off';
	import { moveBefore, prependNew, readStringArray, sortByOrder } from '$lib/drag-order';
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
		sessionCollection,
		loading,
		sessions,
		externalCronJobs,
		externalCronError,
		selectedExternalCronJob,
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
		ondelete,
		onexternalopen,
		onsearch,
		isImage,
		automaticIcon,
		elapsed
	}: {
		element?: HTMLElement;
		open: boolean;
		mobile: boolean;
		selectedProject: Project | null;
		sessionCollection: 'chats' | 'cron';
		loading: boolean;
		sessions: Session[];
		externalCronJobs: import('./types').ExternalCronJob[];
		externalCronError: string;
		selectedExternalCronJob: import('./types').ExternalCronJob | null;
		selectedSession: Session | null;
		selectedDelivery: string;
		selectedStatus: Session['status'];
		sessionSearch: string;
		showArchived: boolean;
		now: number;
		oncreate: () => void;
		onopen: (session: Session) => void;
		onback: (trigger: HTMLElement) => void;
		onedit: (event: MouseEvent, session: Session) => void;
		onicon: (event: MouseEvent, session: Session) => void;
		onarchive: (event: MouseEvent, session: Session) => void;
		ondelete: (event: MouseEvent, session: Session) => void;
		onexternalopen: (job: import('./types').ExternalCronJob) => void;
		onsearch: (event?: SubmitEvent) => void;
		isImage: (icon: string | null) => boolean;
		automaticIcon: (title?: string | null) => string;
		elapsed: (startedAt: string, now: number) => string;
	} = $props();
	let sessionOrder = $state<string[]>([]);
	let draggedSessionId = $state<string | null>(null);
	let searchOpen = $state(Boolean(sessionSearch || showArchived));
	let searchInput = $state<HTMLInputElement>();
	let swipedSessionId = $state<string | null>(null);
	let swipeOffset = $state(0);
	let swipeSessionId = $state<string | null>(null);
	let swipePointerId: number | null = null;
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeStartOffset = 0;
	let swipeDragging = $state(false);
	let suppressSessionClick: string | null = null;
	const swipeActionsWidth = 132;
	const sessionOrderKey = () =>
		`hue:session-order:${selectedProject?.id ?? (sessionCollection === 'cron' ? 'cron' : 'general')}`;
	const orderedSessions = $derived(
		sortByOrder(sessions, sessionOrder, ({ sessionId }) => sessionId)
	);
	const filteredExternalCronJobs = $derived(
		externalCronJobs.filter((job) =>
			`${job.name} ${job.profileName} ${job.schedule} ${job.state}`
				.toLowerCase()
				.includes(sessionSearch.trim().toLowerCase())
		)
	);

	$effect(() => {
		const key = sessionOrderKey();
		const next = prependNew(
			readStringArray(localStorage, key),
			sessions.map(({ sessionId }) => sessionId)
		);
		sessionOrder = next;
		localStorage.setItem(key, JSON.stringify(next));
	});
	onMount(() => {
		const refreshOrder = () => {
			sessionOrder = prependNew(
				readStringArray(localStorage, sessionOrderKey()),
				sessions.map(({ sessionId }) => sessionId)
			);
		};
		window.addEventListener('hue:session-order', refreshOrder);
		window.addEventListener('pointermove', moveSessionSwipe, { passive: false });
		window.addEventListener('pointerup', finishSessionSwipe);
		window.addEventListener('pointercancel', cancelSessionSwipe);
		return () => {
			window.removeEventListener('hue:session-order', refreshOrder);
			window.removeEventListener('pointermove', moveSessionSwipe);
			window.removeEventListener('pointerup', finishSessionSwipe);
			window.removeEventListener('pointercancel', cancelSessionSwipe);
		};
	});

	function startSessionSwipe(event: PointerEvent, sessionId: string) {
		if (!mobile || event.pointerType !== 'touch' || !event.isPrimary) return;
		swipeSessionId = sessionId;
		swipePointerId = event.pointerId;
		swipeStartX = event.clientX;
		swipeStartY = event.clientY;
		swipeStartOffset = swipedSessionId === sessionId ? -swipeActionsWidth : 0;
		swipeOffset = swipeStartOffset;
		swipeDragging = false;
		if (swipedSessionId !== sessionId) swipedSessionId = null;
		suppressSessionClick = null;
	}

	function moveSessionSwipe(event: PointerEvent) {
		if (event.pointerId !== swipePointerId) return;
		const deltaX = event.clientX - swipeStartX;
		const deltaY = event.clientY - swipeStartY;
		if (!swipeDragging) {
			if (Math.hypot(deltaX, deltaY) < 8) return;
			if (Math.abs(deltaY) >= Math.abs(deltaX)) return cancelSessionSwipe();
			swipeDragging = true;
		}
		event.preventDefault();
		swipeOffset = Math.max(-swipeActionsWidth, Math.min(0, swipeStartOffset + deltaX));
	}

	function finishSessionSwipe(event: PointerEvent) {
		if (event.pointerId !== swipePointerId) return;
		if (swipeDragging && swipeSessionId) {
			swipedSessionId = swipeOffset < -swipeActionsWidth / 3 ? swipeSessionId : null;
			swipeOffset = swipedSessionId ? -swipeActionsWidth : 0;
			suppressSessionClick = swipeSessionId;
			setTimeout(() => (suppressSessionClick = null));
		}
		swipeSessionId = null;
		swipePointerId = null;
		swipeDragging = false;
	}

	function cancelSessionSwipe() {
		swipeSessionId = null;
		swipePointerId = null;
		swipeDragging = false;
		swipeOffset = swipedSessionId ? -swipeActionsWidth : 0;
	}

	function openSession(session: Session) {
		if (suppressSessionClick === session.sessionId) return;
		if (swipedSessionId === session.sessionId) return closeSwipe();
		onopen(session);
	}

	function closeSwipe() {
		swipedSessionId = null;
		swipeOffset = 0;
	}

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
			localStorage.setItem(sessionOrderKey(), JSON.stringify(sessionOrder));
		}
		draggedSessionId = null;
	}
	async function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) {
			await tick();
			searchInput?.focus();
			return;
		}
		sessionSearch = '';
		showArchived = false;
		onsearch();
	}
	const rowState = (session: Session) =>
		sessionRowState({
			...session,
			status: session.error ? 'failed' : session.status,
			unreadAttention: session.attention || session.unreadAttention,
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
	class="context-panel flex min-h-0 flex-col border-r border-border bg-[var(--navigation-surface)]"
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
			onclick={(event) => onback(event.currentTarget)}
			><ArrowLeft width={20} height={20} aria-hidden="true" /></button
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
					/>{/if}{:else if sessionCollection === 'cron'}<CalendarClock
					class="title-icon size-(--navigation-icon-size) shrink-0 text-muted-foreground"
					width={18}
					height={18}
					aria-hidden="true"
				/>{:else}<MessageSquare
					class="title-icon size-(--navigation-icon-size) shrink-0 text-muted-foreground"
					width={18}
					height={18}
					aria-hidden="true"
				/>{/if}<span class="truncate"
				>{selectedProject?.name ?? (sessionCollection === 'cron' ? 'Cron tasks' : 'Chats')}</span
			>
		</h1>
		{#if loading}<LoaderCircle
				width={16}
				height={16}
				class="loading-indicator active shrink-0 animate-spin"
				role="status"
				aria-label="Loading project contents"
			/>{/if}
		<div class="flex shrink-0 items-center gap-1">
			<button
				class="grid size-11 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				class:bg-accent={searchOpen}
				type="button"
				aria-label="Search sessions"
				aria-pressed={searchOpen}
				title="Search sessions"
				onclick={toggleSearch}><Search width={18} height={18} aria-hidden="true" /></button
			>
			{#if sessionCollection !== 'cron' || selectedProject}<button
					class="grid size-11 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
					type="button"
					aria-label="Add new session"
					title="Add new session"
					onclick={() => oncreate()}
					disabled={selectedProject?.rootAvailable === false}
					><Plus width={20} height={20} aria-hidden="true" /></button
				>{/if}
		</div>
	</header>
	{#if searchOpen}<form
			class="flex gap-2 border-b border-[var(--navigation-border)] p-3"
			role="search"
			onsubmit={onsearch}
		>
			<label
				class="flex min-h-(--control-height) min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2.5"
			>
				<Search width={16} height={16} aria-hidden="true" /><span class="sr-only"
					>Search Sessions</span
				><input
					bind:this={searchInput}
					class="min-w-0 flex-1 border-0 bg-transparent"
					bind:value={sessionSearch}
					type="search"
					placeholder="Search Sessions"
				/>
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
				>{#if showArchived}<ArchiveRestore
						width={17}
						height={17}
						aria-hidden="true"
					/>{:else}<ArchiveX width={17} height={17} aria-hidden="true" />{/if}</button
			>
		</form>{/if}
	<div class="item-list grid gap-1 overflow-auto p-3">
		{#each orderedSessions as session (session.sessionId)}
			{@const state = rowState(session)}
			<div
				class="session-row relative w-full min-w-0"
				role="group"
				aria-label={`Session ${session.title || 'Untitled session'}`}
				ondragover={(event) => allowSessionDrop(event, session)}
				ondrop={(event) => dropSession(event, session)}
				onpointerdown={(event) => startSessionSwipe(event, session.sessionId)}
			>
				<div
					class="session-swipe-actions absolute inset-y-0 right-0 hidden w-[132px] grid-cols-3"
					inert={swipedSessionId !== session.sessionId}
				>
					<button
						class="grid min-h-11 place-items-center text-muted-foreground"
						aria-label={`Edit ${session.title || 'Untitled session'}`}
						title={`Edit ${session.title || 'Untitled session'}`}
						onclick={(event) => {
							closeSwipe();
							onedit(event, session);
						}}><Pencil width={18} height={18} aria-hidden="true" /></button
					>
					{#if !session.archived}<button
							class="grid min-h-11 place-items-center text-muted-foreground"
							aria-label={`Archive ${session.title || 'Untitled session'}`}
							title={`Archive ${session.title || 'Untitled session'}`}
							onclick={(event) => {
								closeSwipe();
								onarchive(event, session);
							}}><Archive width={18} height={18} aria-hidden="true" /></button
						>{/if}
					<button
						class="grid min-h-11 place-items-center text-destructive"
						aria-label={`Delete ${session.title || 'Untitled session'}`}
						title={`Delete ${session.title || 'Untitled session'}`}
						onclick={(event) => {
							closeSwipe();
							ondelete(event, session);
						}}><Trash2 width={18} height={18} aria-hidden="true" /></button
					>
				</div>
				<div
					class="session-swipe-content relative z-1"
					class:dragging={swipeDragging && swipeSessionId === session.sessionId}
					style:transform={mobile &&
					(swipedSessionId === session.sessionId || swipeSessionId === session.sessionId)
						? `translateX(${swipeOffset}px)`
						: undefined}
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
						<span
							class="session-state-badge pointer-events-none absolute right-0 bottom-0 grid size-[18px] place-items-center rounded-full border border-card bg-card"
							title={state.label}
							aria-hidden="true"
						>
							{#if state.icon === 'running'}<LoaderCircle
									class="animate-spin"
									width={12}
									height={12}
								/>{:else if state.icon === 'waiting'}<CircleHelp width={12} height={12} />
							{:else if state.icon === 'failed'}<CircleX width={12} height={12} />
							{:else if state.icon === 'cancelled'}<Ban width={12} height={12} />
							{:else if state.icon === 'unknown'}<WifiOff width={12} height={12} />
							{:else}<CircleCheck width={12} height={12} />{/if}
						</span>
					</button>
					<button
						class="session-select flex min-h-(--control-height) w-full cursor-grab items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1 pr-2 pl-8 text-left hover:border-border hover:bg-accent active:cursor-grabbing [&.active]:border-border [&.active]:bg-accent"
						class:active={selectedSession?.sessionId === session.sessionId}
						aria-current={selectedSession?.sessionId === session.sessionId ? 'page' : undefined}
						aria-label={`${session.title || 'Untitled session'}, ${state.label}`}
						draggable={session.available !== false}
						ondragstart={(event) => dragSession(event, session)}
						ondragend={finishSessionDrag}
						onclick={() => openSession(session)}
					>
						<div class="session-row-copy min-w-0 flex-1">
							<div class="session-row-title flex min-w-0 items-baseline gap-2">
								<strong>{session.title || 'Untitled session'}</strong>{#if session.pinned}<Pin
										width={12}
										height={12}
										aria-label="Pinned"
									/>{/if}
								{#if session.busySince}<span
										class="busy-timer text-xs whitespace-nowrap text-sky-400 tabular-nums"
										aria-label={`Busy for ${elapsed(session.busySince, now)}`}
										>{elapsed(session.busySince, now)}</span
									>{/if}
							</div>
							<small
								class:text-[var(--warning)]={session.available === false}
								title={session.updatedAt ? new Date(session.updatedAt).toLocaleString() : undefined}
								><span class="desktop-session-date"
									>{session.updatedAt
										? new Date(session.updatedAt).toLocaleString()
										: session.available === false
											? session.recovery
											: 'New session'}</span
								><span class="mobile-session-date hidden"
									>{session.updatedAt
										? new Date(session.updatedAt).toLocaleDateString(undefined, {
												month: 'short',
												day: 'numeric'
											})
										: session.available === false
											? session.recovery
											: 'New session'}</span
								>{session.tags?.length ? ` · ${session.tags.join(', ')}` : ''}</small
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
				</div>
				{#if !session.archived}<button
						class="session-archive session-desktop-action absolute top-1/2 right-8 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
						aria-label={`Archive ${session.title || 'Untitled session'}`}
						title={`Archive ${session.title || 'Untitled session'}`}
						onclick={(event) => onarchive(event, session)}
						><Archive width={15} height={15} aria-hidden="true" /></button
					>{/if}
				<button
					class="session-edit session-desktop-action absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md opacity-0 hover:bg-accent [.session-row:focus-within_&]:opacity-100 [.session-row:hover_&]:opacity-100"
					aria-label={`Edit ${session.title || 'Untitled session'}`}
					title={`Edit ${session.title || 'Untitled session'}`}
					onclick={(event) => onedit(event, session)}
					><EllipsisVertical width={16} height={16} aria-hidden="true" /></button
				>
			</div>
		{/each}
		{#if sessionCollection === 'cron' && externalCronJobs.length}<div
				class="mt-2 mb-1 flex items-center justify-between gap-2 border-t border-border px-1 pt-3"
			>
				<strong class="text-xs">Hermes jobs</strong>
				<small class="truncate text-xs text-muted-foreground">Select to manage</small>
			</div>
			{#each filteredExternalCronJobs as job (`${job.profile}:${job.jobId}`)}
				<div
					class="external-cron-row w-full min-w-0"
					role="group"
					aria-label={`Hermes cron job ${job.name}`}
				>
					<button
						class="external-cron-select grid min-h-14 w-full min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 overflow-hidden rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-accent max-[700px]:min-h-16 [&.active]:border-border [&.active]:bg-accent"
						class:active={selectedExternalCronJob?.jobId === job.jobId &&
							selectedExternalCronJob?.profile === job.profile}
						aria-current={selectedExternalCronJob?.jobId === job.jobId &&
						selectedExternalCronJob?.profile === job.profile
							? 'page'
							: undefined}
						onclick={() => onexternalopen(job)}
					>
						<CalendarClock
							class="row-span-2 size-7 text-muted-foreground"
							width={18}
							height={18}
							aria-hidden="true"
						/>
						<div class="min-w-0 overflow-hidden self-end">
							<strong class="block truncate text-sm leading-5">{job.name}</strong>
						</div>
						<div class="flex min-w-0 items-center gap-2 self-start">
							<small class="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground"
								>{job.profileName} · {job.schedule}{job.nextRunAt
									? ` · Next ${new Date(job.nextRunAt).toLocaleString()}`
									: ''}</small
							>
							<span class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
								>{job.enabled ? job.state : 'paused'}</span
							>
						</div>
					</button>
				</div>
			{/each}
		{/if}
		{#if sessionCollection === 'cron' && externalCronError}<p
				class="rounded-md border border-[var(--warning)] p-2 text-xs text-[var(--warning)]"
				role="status"
			>
				Hermes cron inventory unavailable: {externalCronError}
			</p>{/if}
		{#if !loading && sessions.length === 0 && externalCronJobs.length === 0}<p
				class="empty p-4 text-center text-sm text-muted-foreground"
			>
				{sessionCollection === 'cron' && !selectedProject
					? 'No cron tasks yet.'
					: 'No persisted Hermes Sessions yet.'}
			</p>{/if}
	</div>
</aside>
