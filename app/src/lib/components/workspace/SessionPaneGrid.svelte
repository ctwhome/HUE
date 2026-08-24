<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import SessionPanel from './SessionPanel.svelte';
	import type { Project, Session, Workflow } from './types';

	let {
		sessions,
		project,
		projectId,
		workflows,
		primarySession,
		allowDocking = true,
		onpanecount = () => {},
		onprimaryclose,
		onsessionupdate,
		onrunworkflow,
		children
	}: {
		sessions: Session[];
		project: Project | null;
		projectId: string | null;
		workflows: Workflow[];
		primarySession: Session | null;
		allowDocking?: boolean;
		onpanecount?: (count: number) => void;
		onprimaryclose: (session: Session) => void;
		onsessionupdate: (session: Session) => void;
		onrunworkflow: (workflow: Workflow) => void;
		children: Snippet;
	} = $props();
	type PaneSession = Pick<Session, 'sessionId' | 'title' | 'cwd'>;
	let dockedSessions = $state<PaneSession[]>([]);
	let paneRatio = $state({ column: 50, row: 50 });
	let paneGridElement: HTMLElement;
	let paneResize = $state<'column' | 'row' | null>(null);
	let dropPreview = $state(false);
	let hydratedProjectId: string | null | undefined;
	let layoutReady = false;
	let restoredPrimary = $state<PaneSession | null>(null);
	let paneCount = $derived(1 + dockedSessions.length);
	let dropDestination = $derived(
		paneCount === 1 ? 'right' : paneCount < 4 ? 'bottom-right' : 'reflow'
	);
	function setDockedSessions(next: PaneSession[]) {
		dockedSessions = next;
		onpanecount(1 + next.length);
		if (layoutReady) saveLayout();
	}

	const storageKey = (id: string | null) => `hue:session-panes:${id ?? 'none'}`;
	const clampRatio = (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) ? Math.min(75, Math.max(25, value)) : 50;
	function parsePaneSession(session: unknown): PaneSession | null {
		if (
			typeof session !== 'object' ||
			session === null ||
			typeof (session as PaneSession).sessionId !== 'string' ||
			(typeof (session as PaneSession).title !== 'string' && (session as PaneSession).title != null)
		)
			return null;
		return {
			sessionId: (session as PaneSession).sessionId,
			title: (session as PaneSession).title,
			cwd: typeof (session as PaneSession).cwd === 'string' ? (session as PaneSession).cwd : ''
		};
	}
	function saveLayout() {
		if (!allowDocking || !layoutReady || hydratedProjectId !== projectId) return;
		localStorage.setItem(
			storageKey(projectId),
			JSON.stringify({
				sessions: dockedSessions,
				primary: primarySession
					? {
							sessionId: primarySession.sessionId,
							title: primarySession.title,
							cwd: primarySession.cwd
						}
					: restoredPrimary,
				column: paneRatio.column,
				row: paneRatio.row
			})
		);
	}
	$effect(() => {
		if (!allowDocking || hydratedProjectId === projectId) return;
		layoutReady = false;
		hydratedProjectId = projectId;
		setDockedSessions([]);
		paneRatio.column = 50;
		paneRatio.row = 50;
		try {
			const saved = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? 'null') as {
				sessions?: unknown;
				primary?: unknown;
				column?: unknown;
				row?: unknown;
			} | null;
			if (saved && Array.isArray(saved.sessions)) {
				setDockedSessions(
					saved.sessions
						.map(parsePaneSession)
						.filter((session): session is PaneSession => session !== null)
				);
				restoredPrimary = parsePaneSession(saved.primary);
				paneRatio.column = clampRatio(saved.column);
				paneRatio.row = clampRatio(saved.row);
			}
		} catch {
			localStorage.removeItem(storageKey(projectId));
		}
		layoutReady = true;
	});
	$effect(() => {
		if (!allowDocking) return;
		if (primarySession) {
			restoredPrimary = {
				sessionId: primarySession.sessionId,
				title: primarySession.title,
				cwd: primarySession.cwd
			};
			saveLayout();
			return;
		}
		if (restoredPrimary) onprimaryclose(restoredPrimary);
	});
	$effect(() => onpanecount(paneCount));

	function dropSession(event: DragEvent) {
		event.preventDefault();
		dropPreview = false;
		if (!allowDocking) return;
		const sessionId = event.dataTransfer?.getData('application/x-hue-session-id');
		const session = sessions.find((candidate) => candidate.sessionId === sessionId);
		if (
			!session ||
			session.available === false ||
			session.sessionId === primarySession?.sessionId ||
			dockedSessions.some((candidate) => candidate.sessionId === session.sessionId)
		)
			return;
		const pane = { sessionId: session.sessionId, title: session.title, cwd: session.cwd };
		if (!primarySession) onprimaryclose(pane);
		else setDockedSessions([...dockedSessions, pane]);
	}

	function closePrimary() {
		const [next, ...remaining] = dockedSessions;
		if (!next) return;
		setDockedSessions(remaining);
		onprimaryclose(next);
	}

	function currentPaneTitle(session: PaneSession) {
		return (
			sessions.find((candidate) => candidate.sessionId === session.sessionId)?.title ??
			session.title
		);
	}
	function currentPaneSession(session: PaneSession): Session {
		return sessions.find((candidate) => candidate.sessionId === session.sessionId) ?? session;
	}

	function previewDrop(event: DragEvent) {
		if (!allowDocking) return;
		if (!Array.from(event.dataTransfer?.types ?? []).includes('application/x-hue-session-id'))
			return;
		const sessionId = event.dataTransfer?.getData('application/x-hue-session-id');
		if (
			sessionId === primarySession?.sessionId ||
			dockedSessions.some((session) => session.sessionId === sessionId)
		) {
			dropPreview = false;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropPreview = true;
	}

	function leaveDropPreview(event: DragEvent) {
		if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
			dropPreview = false;
		}
	}

	function startResize(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		paneResize = target.dataset.axis as 'column' | 'row';
	}

	function resize(event: PointerEvent) {
		if (!paneResize) return;
		const bounds = paneGridElement.getBoundingClientRect();
		if (paneResize === 'column')
			paneRatio.column = Math.min(
				75,
				Math.max(25, ((event.clientX - bounds.left) / bounds.width) * 100)
			);
		else
			paneRatio.row = Math.min(
				75,
				Math.max(25, ((event.clientY - bounds.top) / bounds.height) * 100)
			);
	}
	function finishResize() {
		paneResize = null;
		saveLayout();
	}

	function resizeWithKeyboard(event: KeyboardEvent, axis: 'column' | 'row') {
		const change =
			axis === 'column'
				? event.key === 'ArrowRight'
					? 5
					: event.key === 'ArrowLeft'
						? -5
						: 0
				: event.key === 'ArrowDown'
					? 5
					: event.key === 'ArrowUp'
						? -5
						: 0;
		if (!change) return;
		event.preventDefault();
		if (axis === 'column') paneRatio.column = Math.min(75, Math.max(25, paneRatio.column + change));
		else paneRatio.row = Math.min(75, Math.max(25, paneRatio.row + change));
		saveLayout();
	}
</script>

<svelte:window
	ondragend={() => (dropPreview = false)}
	onkeydown={(event) => event.key === 'Escape' && (dropPreview = false)}
/>

<section
	bind:this={paneGridElement}
	class="session-pane-grid min-h-0 min-w-0 flex-1"
	aria-label="Session panes"
	data-pane-count={paneCount}
	style={`--pane-column: ${paneRatio.column}%; --pane-row: ${paneRatio.row}%`}
	ondragenter={previewDrop}
	ondragover={previewDrop}
	ondragleave={leaveDropPreview}
	ondrop={dropSession}
>
	<article
		class="session-pane-primary flex min-h-0 min-w-0 flex-col overflow-hidden"
		aria-label={`${primarySession?.title || 'Current session'} pane`}
	>
		{#if paneCount > 1 && primarySession}<header
				class="session-pane-header flex h-11 items-center gap-2 border-b border-border bg-card px-3"
			>
				<strong class="min-w-0 flex-1 truncate text-sm"
					>{primarySession.title || 'Untitled session'}</strong
				>
				<button
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					aria-label={`Close ${primarySession.title || 'Untitled session'} pane`}
					title="Close pane"
					onclick={closePrimary}><X size={16} aria-hidden="true" /></button
				>
			</header>{/if}
		{@render children()}
	</article>
	{#if dropPreview}<div
			class="session-drop-preview"
			data-destination={dropDestination}
			aria-hidden="true"
		></div>{/if}
	{#each dockedSessions as session (session.sessionId)}
		<article
			class="session-pane flex min-h-0 min-w-0 flex-col overflow-hidden"
			aria-label={`${currentPaneTitle(session) || 'Untitled session'} pane`}
		>
			<header
				class="session-pane-header flex h-11 items-center gap-2 border-b border-border bg-card px-3"
			>
				<strong class="min-w-0 flex-1 truncate text-sm"
					>{currentPaneTitle(session) || 'Untitled session'}</strong
				>
				<button
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					aria-label={`Close ${currentPaneTitle(session) || 'Untitled session'} pane`}
					title="Close pane"
					onclick={() =>
						setDockedSessions(
							dockedSessions.filter((candidate) => candidate.sessionId !== session.sessionId)
						)}><X size={16} aria-hidden="true" /></button
				>
			</header>
			<SessionPanel
				{project}
				session={currentPaneSession(session)}
				{workflows}
				onupdate={onsessionupdate}
				{onrunworkflow}
			/>
		</article>
	{/each}
	{#if paneCount > 1 && paneCount <= 4}
		<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role (ARIA separator is keyboard-operable.) -->
		<button
			type="button"
			class="session-pane-resizer column"
			role="separator"
			aria-label="Resize Session panes"
			aria-orientation="vertical"
			aria-valuemin="25"
			aria-valuemax="75"
			aria-valuenow={Math.round(paneRatio.column)}
			tabindex="0"
			data-axis="column"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
			onkeydown={(event) => resizeWithKeyboard(event, 'column')}
		></button>
	{/if}
	{#if paneCount > 2 && paneCount <= 4}
		<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role (ARIA separator is keyboard-operable.) -->
		<button
			type="button"
			class="session-pane-resizer row"
			role="separator"
			aria-label="Resize Session pane rows"
			aria-orientation="horizontal"
			aria-valuemin="25"
			aria-valuemax="75"
			aria-valuenow={Math.round(paneRatio.row)}
			tabindex="0"
			data-axis="row"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
			onkeydown={(event) => resizeWithKeyboard(event, 'row')}
		></button>
	{/if}
</section>
