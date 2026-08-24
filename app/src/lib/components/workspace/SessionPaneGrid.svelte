<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import type { Session } from './types';

	let {
		sessions,
		projectId,
		primarySession,
		allowDocking = true,
		onpanecount = () => {},
		onprimaryclose,
		children
	}: {
		sessions: Session[];
		projectId: string | null;
		primarySession: Session | null;
		allowDocking?: boolean;
		onpanecount?: (count: number) => void;
		onprimaryclose: (session: Session) => void;
		children: Snippet;
	} = $props();
	type PaneSession = Pick<Session, 'sessionId' | 'title' | 'cwd'>;
	let dockedSessions = $state<PaneSession[]>([]);
	let paneColumnPercent = $state(50);
	let paneRowPercent = $state(50);
	let paneGridElement: HTMLElement;
	let paneResize = $state<'column' | 'row' | null>(null);
	let dropPreview = $state(false);
	let hydratedProjectId = $state<string | null>();
	let restoredPrimary = $state<PaneSession | null>(null);
	let paneCount = $derived(1 + dockedSessions.length);
	let dropDestination = $derived(
		paneCount === 1 ? 'right' : paneCount < 4 ? 'bottom-right' : 'reflow'
	);

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
	$effect(() => {
		if (!allowDocking || hydratedProjectId === projectId) return;
		hydratedProjectId = projectId;
		dockedSessions = [];
		paneColumnPercent = 50;
		paneRowPercent = 50;
		try {
			const saved = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? 'null') as {
				sessions?: unknown;
				primary?: unknown;
				column?: unknown;
				row?: unknown;
			} | null;
			if (!saved || !Array.isArray(saved.sessions)) return;
			dockedSessions = saved.sessions
				.map(parsePaneSession)
				.filter((session): session is PaneSession => session !== null);
			restoredPrimary = parsePaneSession(saved.primary);
			paneColumnPercent = clampRatio(saved.column);
			paneRowPercent = clampRatio(saved.row);
		} catch {
			localStorage.removeItem(storageKey(projectId));
		}
	});
	$effect(() => {
		if (!allowDocking) return;
		if (primarySession) {
			restoredPrimary = {
				sessionId: primarySession.sessionId,
				title: primarySession.title,
				cwd: primarySession.cwd
			};
			return;
		}
		if (restoredPrimary) onprimaryclose(restoredPrimary);
	});
	$effect(() => {
		if (!allowDocking || hydratedProjectId !== projectId) return;
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
				column: paneColumnPercent,
				row: paneRowPercent
			})
		);
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
		else dockedSessions = [...dockedSessions, pane];
	}

	function closePrimary() {
		const [next, ...remaining] = dockedSessions;
		if (!next) return;
		dockedSessions = remaining;
		onprimaryclose(next);
	}

	function currentPaneTitle(session: PaneSession) {
		return (
			sessions.find((candidate) => candidate.sessionId === session.sessionId)?.title ??
			session.title
		);
	}

	function previewDrop(event: DragEvent) {
		if (!allowDocking) return;
		if (!Array.from(event.dataTransfer?.types ?? []).includes('application/x-hue-session-id'))
			return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropPreview = true;
	}

	function leaveDropPreview(event: DragEvent) {
		if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
			dropPreview = false;
		}
	}

	function embeddedSessionUrl(sessionId: string) {
		const query = new URLSearchParams({
			project: projectId ?? 'none',
			session: sessionId,
			embed: 'chat'
		});
		return `/?${query}`;
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
			paneColumnPercent = Math.min(
				75,
				Math.max(25, ((event.clientX - bounds.left) / bounds.width) * 100)
			);
		else
			paneRowPercent = Math.min(
				75,
				Math.max(25, ((event.clientY - bounds.top) / bounds.height) * 100)
			);
	}

	function resizeWithKeyboard(event: KeyboardEvent) {
		const axis = (event.currentTarget as HTMLElement).dataset.axis as 'column' | 'row';
		const keys = axis === 'column' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const change = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 5 : -5;
		if (axis === 'column')
			paneColumnPercent = Math.min(75, Math.max(25, paneColumnPercent + change));
		else paneRowPercent = Math.min(75, Math.max(25, paneRowPercent + change));
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
	style={`--pane-column: ${paneColumnPercent}%; --pane-row: ${paneRowPercent}%`}
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
						(dockedSessions = dockedSessions.filter(
							(candidate) => candidate.sessionId !== session.sessionId
						))}><X size={16} aria-hidden="true" /></button
				>
			</header>
			<iframe
				class="min-h-0 w-full flex-1 border-0 bg-background"
				src={embeddedSessionUrl(session.sessionId)}
				title={currentPaneTitle(session) || 'Untitled session'}
			></iframe>
		</article>
	{/each}
	{#if paneCount > 1 && paneCount <= 4}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
		<div
			class="session-pane-resizer column"
			role="separator"
			aria-label="Resize Session panes"
			aria-orientation="vertical"
			aria-valuemin="25"
			aria-valuemax="75"
			aria-valuenow={Math.round(paneColumnPercent)}
			tabindex="0"
			data-axis="column"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={() => (paneResize = null)}
			onpointercancel={() => (paneResize = null)}
			onkeydown={resizeWithKeyboard}
		></div>
	{/if}
	{#if paneCount > 2 && paneCount <= 4}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-operable.) -->
		<div
			class="session-pane-resizer row"
			role="separator"
			aria-label="Resize Session pane rows"
			aria-orientation="horizontal"
			aria-valuemin="25"
			aria-valuemax="75"
			aria-valuenow={Math.round(paneRowPercent)}
			tabindex="0"
			data-axis="row"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={() => (paneResize = null)}
			onpointercancel={() => (paneResize = null)}
			onkeydown={resizeWithKeyboard}
		></div>
	{/if}
</section>
