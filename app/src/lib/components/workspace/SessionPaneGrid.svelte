<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import type { Session } from './types';

	let {
		sessions,
		projectId,
		selectedSessionId,
		onpanecount = () => {},
		children
	}: {
		sessions: Session[];
		projectId: string | null;
		selectedSessionId: string | null;
		onpanecount?: (count: number) => void;
		children: Snippet;
	} = $props();
	let dockedSessions = $state<Session[]>([]);
	let paneColumnPercent = $state(50);
	let paneRowPercent = $state(50);
	let paneGridElement: HTMLElement;
	let paneResize = $state<'column' | 'row' | null>(null);
	let previousProjectId = $state<string | null>();
	let paneCount = $derived(1 + dockedSessions.length);

	$effect(() => {
		if (previousProjectId === undefined) previousProjectId = projectId;
		else if (previousProjectId !== projectId) {
			previousProjectId = projectId;
			dockedSessions = [];
		}
	});
	$effect(() => onpanecount(paneCount));

	function dropSession(event: DragEvent) {
		event.preventDefault();
		const sessionId = event.dataTransfer?.getData('application/x-hue-session-id');
		const session = sessions.find((candidate) => candidate.sessionId === sessionId);
		if (
			!session ||
			session.available === false ||
			session.sessionId === selectedSessionId ||
			dockedSessions.some((candidate) => candidate.sessionId === session.sessionId)
		)
			return;
		dockedSessions = [...dockedSessions, session];
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

<section
	bind:this={paneGridElement}
	class="session-pane-grid min-h-0 min-w-0 flex-1"
	aria-label="Session panes"
	data-pane-count={paneCount}
	style={`--pane-column: ${paneColumnPercent}%; --pane-row: ${paneRowPercent}%`}
	ondragover={(event) => event.preventDefault()}
	ondrop={dropSession}
>
	{@render children()}
	{#each dockedSessions as session (session.sessionId)}
		<article
			class="session-pane flex min-h-0 min-w-0 flex-col overflow-hidden"
			aria-label={`${session.title || 'Untitled session'} pane`}
		>
			<header
				class="session-pane-header flex h-11 items-center gap-2 border-b border-border bg-card px-3"
			>
				<strong class="min-w-0 flex-1 truncate text-sm"
					>{session.title || 'Untitled session'}</strong
				>
				<button
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					aria-label={`Close ${session.title || 'Untitled session'} pane`}
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
				title={session.title || 'Untitled session'}
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
