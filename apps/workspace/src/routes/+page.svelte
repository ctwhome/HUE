<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { marked } from 'marked';
	import sanitizeHtml from 'sanitize-html';
	import {
		applySessionEvents,
		isCurrentSessionRequest,
		isCurrentTabRequest,
		isTurnBusy,
		runSingleFlight
	} from '$lib';
	import type { PageData } from './$types';

	type Project = PageData['projects'][number];
	type Session = {
		sessionId: string;
		cwd: string;
		title?: string | null;
		updatedAt?: string | null;
	};
	type Workflow = { id: string; name: string; prompt: string; profile: string };
	type TranscriptMessage = { role: 'user' | 'assistant'; text: string };
	type SessionEvent = { sequence: number; type: string; payload: Record<string, unknown> };
	type PendingEnvelope = { id: string; projectId: string; sessionId: string; text: string };
	type ActiveTurn = {
		messageId: string;
		status: 'queued' | 'running' | 'unknown';
		output: string;
		error: string | null;
	};

	let { data }: { data: PageData } = $props();
	let projects = $state<Project[]>(untrack(() => [...data.projects]));
	let selectedProject = $state<Project | null>(untrack(() => data.projects[0] ?? null));
	let sessions = $state<Session[]>([]);
	let workflows = $state<Workflow[]>([]);
	let selectedSession = $state<Session | null>(null);
	let transcript = $state<TranscriptMessage[]>([]);
	let activeTab = $state<'sessions' | 'workflows'>('sessions');
	let loading = $state(false);
	let error = $state('');
	let projectName = $state('');
	let projectRoot = $state('');
	let workflowName = $state('');
	let workflowPrompt = $state('');
	let composer = $state('');
	let delivery = $state('');
	let pendingAssistant = $state('');
	let eventCursor = $state(0);
	let activeMessageId = $state('');
	let pendingEnvelope = $state<PendingEnvelope | null>(null);
	let mobileDrawer = $state<'projects' | 'sessions' | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let sessionRequestGeneration = 0;
	let tabRequestGeneration = 0;
	const pollFlight: { current: Promise<void> | null } = { current: null };

	class ApiError extends Error {}

	async function api<T>(url: string, options?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...options,
			headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
		});
		const body = (await response.json()) as T & { error?: string };
		if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`);
		return body;
	}

	async function chooseProject(project: Project) {
		saveCurrentDraft();
		sessionRequestGeneration += 1;
		stopPolling();
		selectedProject = project;
		selectedSession = null;
		pendingEnvelope = null;
		transcript = [];
		error = '';
		mobileDrawer = 'sessions';
		await loadActiveTab();
	}

	async function loadActiveTab() {
		if (!selectedProject) return;
		const request = {
			generation: ++tabRequestGeneration,
			projectId: selectedProject.id,
			tab: activeTab
		};
		loading = true;
		error = '';
		try {
			if (request.tab === 'sessions') {
				const body = await api<{ sessions: Session[] }>(
					`/api/projects/${request.projectId}/sessions`
				);
				if (!isCurrentTabRequest(request, currentTabRequest())) return;
				sessions = body.sessions;
			} else {
				const body = await api<{ workflows: Workflow[] }>(
					`/api/projects/${request.projectId}/workflows`
				);
				if (!isCurrentTabRequest(request, currentTabRequest())) return;
				workflows = body.workflows;
			}
		} catch (cause) {
			if (isCurrentTabRequest(request, currentTabRequest())) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (isCurrentTabRequest(request, currentTabRequest())) loading = false;
		}
	}

	function currentTabRequest() {
		return {
			generation: tabRequestGeneration,
			projectId: selectedProject?.id ?? '',
			tab: activeTab
		};
	}

	async function changeTab(tab: 'sessions' | 'workflows') {
		activeTab = tab;
		await loadActiveTab();
	}

	async function addProject(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			const body = await api<{ project: Project }>('/api/projects', {
				method: 'POST',
				body: JSON.stringify({ name: projectName, rootPath: projectRoot })
			});
			projects = [...projects, body.project];
			projectName = '';
			projectRoot = '';
			await chooseProject(body.project);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	async function createSession(): Promise<Session | null> {
		if (!selectedProject) return null;
		saveCurrentDraft();
		loading = true;
		try {
			const body = await api<{ session: Session }>(`/api/projects/${selectedProject.id}/sessions`, {
				method: 'POST'
			});
			sessions = [body.session, ...sessions];
			selectedSession = body.session;
			transcript = [];
			eventCursor = 0;
			restoreDraft();
			mobileDrawer = null;
			return body.session;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			return null;
		} finally {
			loading = false;
		}
	}

	async function openSession(session: Session) {
		if (!selectedProject) return;
		const request = {
			generation: ++sessionRequestGeneration,
			projectId: selectedProject.id,
			sessionId: session.sessionId
		};
		saveCurrentDraft();
		stopPolling();
		selectedSession = session;
		loading = true;
		error = '';
		try {
			const body = await api<{
				transcript: TranscriptMessage[];
				transcriptError?: string;
				cursor: number;
				activeTurn: ActiveTurn | null;
			}>(`/api/projects/${selectedProject.id}/sessions/${session.sessionId}`);
			if (
				!selectedProject ||
				!selectedSession ||
				!isCurrentSessionRequest(request, {
					generation: sessionRequestGeneration,
					projectId: selectedProject.id,
					sessionId: selectedSession.sessionId
				})
			) {
				return;
			}
			transcript = body.transcript;
			eventCursor = body.cursor;
			activeMessageId = body.activeTurn?.messageId ?? '';
			pendingAssistant = body.activeTurn?.output ?? '';
			delivery = body.activeTurn
				? body.activeTurn.status === 'queued'
					? 'accepted'
					: body.activeTurn.status === 'unknown'
						? 'delivery unknown'
						: 'running'
				: '';
			error = body.activeTurn?.error ?? body.transcriptError ?? '';
			restoreDraft();
			mobileDrawer = null;
			if (body.activeTurn && body.activeTurn.status !== 'unknown') startPolling();
		} catch (cause) {
			if (request.generation === sessionRequestGeneration) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request.generation === sessionRequestGeneration) loading = false;
		}
	}

	async function addWorkflow(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedProject) return;
		try {
			const body = await api<{ workflow: Workflow }>(
				`/api/projects/${selectedProject.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify({ name: workflowName, prompt: workflowPrompt })
				}
			);
			workflows = [...workflows, body.workflow];
			workflowName = '';
			workflowPrompt = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	async function runWorkflow(workflow: Workflow) {
		activeTab = 'sessions';
		const session = await createSession();
		if (session) await sendText(workflow.prompt);
	}

	async function submitMessage(event: SubmitEvent) {
		event.preventDefault();
		if (isTurnBusy(delivery)) return;
		const text = composer;
		if (!text.trim()) return;
		if (await sendText(text)) {
			composer = '';
			clearCurrentDraft();
		}
	}

	async function sendText(text: string): Promise<boolean> {
		if (!selectedProject || !selectedSession || isTurnBusy(delivery)) return false;
		const session = selectedSession;
		const envelope =
			pendingEnvelope?.projectId === selectedProject.id &&
			pendingEnvelope.sessionId === selectedSession.sessionId &&
			pendingEnvelope.text === text
				? pendingEnvelope
				: {
						id: crypto.randomUUID(),
						projectId: selectedProject.id,
						sessionId: selectedSession.sessionId,
						text
					};
		const messageId = envelope.id;
		activeMessageId = messageId;
		pendingAssistant = '';
		delivery = 'saving';
		try {
			const accepted = await api<{ duplicate: boolean; status: string }>(
				`/api/projects/${selectedProject.id}/sessions/${selectedSession.sessionId}/messages`,
				{
					method: 'POST',
					body: JSON.stringify({ messageId, text })
				}
			);
			pendingEnvelope = null;
			clearPendingEnvelope();
			if (accepted.duplicate) {
				if (['completed', 'failed', 'unknown'].includes(accepted.status)) {
					await openSession(session);
					delivery = accepted.status === 'unknown' ? 'delivery unknown' : accepted.status;
					return true;
				}
				delivery = accepted.status === 'queued' ? 'accepted' : accepted.status;
				startPolling();
				return true;
			}
			transcript = [...transcript, { role: 'user', text }];
			delivery = 'accepted';
			startPolling();
			return true;
		} catch (cause) {
			const uncertain = !(cause instanceof ApiError);
			pendingEnvelope = uncertain ? envelope : null;
			if (uncertain) savePendingEnvelope(envelope);
			else clearPendingEnvelope();
			activeMessageId = uncertain ? messageId : '';
			delivery = uncertain ? 'delivery unknown' : 'not accepted';
			error = cause instanceof Error ? cause.message : String(cause);
			return false;
		}
	}

	async function retryPendingMessage() {
		if (!pendingEnvelope || isTurnBusy(delivery)) return;
		if (await sendText(pendingEnvelope.text)) {
			composer = '';
			clearCurrentDraft();
		}
	}

	function draftKey() {
		return selectedProject && selectedSession
			? `hue:draft:${selectedProject.id}:${selectedSession.sessionId}`
			: '';
	}

	function pendingEnvelopeKey() {
		return selectedProject && selectedSession
			? `hue:pending:${selectedProject.id}:${selectedSession.sessionId}`
			: '';
	}

	function saveCurrentDraft() {
		const key = draftKey();
		if (!key) return;
		if (composer) localStorage.setItem(key, composer);
		else localStorage.removeItem(key);
	}

	function restoreDraft() {
		const key = draftKey();
		composer = key ? (localStorage.getItem(key) ?? '') : '';
		const pending = pendingEnvelopeKey();
		try {
			pendingEnvelope = pending
				? (JSON.parse(localStorage.getItem(pending) ?? 'null') as PendingEnvelope | null)
				: null;
		} catch {
			pendingEnvelope = null;
			if (pending) localStorage.removeItem(pending);
		}
	}

	function savePendingEnvelope(envelope: PendingEnvelope) {
		const key = pendingEnvelopeKey();
		if (key) localStorage.setItem(key, JSON.stringify(envelope));
	}

	function clearPendingEnvelope() {
		const key = pendingEnvelopeKey();
		if (key) localStorage.removeItem(key);
	}

	function clearCurrentDraft() {
		const key = draftKey();
		if (key) localStorage.removeItem(key);
	}

	function updateDraft(event: Event) {
		composer = (event.currentTarget as HTMLTextAreaElement).value;
		saveCurrentDraft();
	}

	function startPolling() {
		stopPolling();
		void syncEvents();
		pollTimer = setInterval(() => void syncEvents(), 650);
	}

	function stopPolling() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
	}

	async function syncEvents() {
		if (!selectedProject || !selectedSession) return;
		const projectId = selectedProject.id;
		const sessionId = selectedSession.sessionId;
		await runSingleFlight(pollFlight, async () => {
			try {
				const body = await api<{ events: SessionEvent[] }>(
					`/api/projects/${projectId}/sessions/${sessionId}/events?after=${eventCursor}`
				);
				if (selectedProject?.id !== projectId || selectedSession?.sessionId !== sessionId) return;
				const next = applySessionEvents(
					{ cursor: eventCursor, activeMessageId, pendingAssistant, delivery, transcript },
					body.events
				);
				eventCursor = next.cursor;
				pendingAssistant = next.pendingAssistant;
				delivery = next.delivery;
				transcript = next.transcript;
				if (!isTurnBusy(delivery)) stopPolling();
			} catch {
				if (selectedProject?.id === projectId && selectedSession?.sessionId === sessionId) {
					delivery = 'reconnecting';
				}
			}
		});
	}

	function renderMarkdown(text: string) {
		return sanitizeHtml(marked.parse(text, { async: false }));
	}

	onMount(() => void loadActiveTab());
	onDestroy(() => {
		stopPolling();
	});
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (mobileDrawer = null)} />

<svelte:head>
	<title>HUE Workspace</title>
	<meta name="description" content="Projects, Workflows, and reliable Hermes Sessions." />
</svelte:head>

<div class="workspace">
	<nav class="mobile-navigation" aria-label="Workspace navigation">
		<button
			aria-controls="project-drawer"
			aria-expanded={mobileDrawer === 'projects'}
			onclick={() => (mobileDrawer = mobileDrawer === 'projects' ? null : 'projects')}
			>Projects</button
		>
		<button
			aria-controls="session-drawer"
			aria-expanded={mobileDrawer === 'sessions'}
			onclick={() => (mobileDrawer = mobileDrawer === 'sessions' ? null : 'sessions')}
			>Sessions</button
		>
	</nav>
	{#if mobileDrawer}<button
			class="drawer-backdrop"
			aria-label="Close navigation"
			onclick={() => (mobileDrawer = null)}
		></button>{/if}
	<aside
		id="project-drawer"
		class="project-rail"
		class:open={mobileDrawer === 'projects'}
		aria-label="Projects"
	>
		<header class="brand">
			<span class="brand-mark">H</span>
			<div><strong>HUE</strong><small>Hermes workspace</small></div>
		</header>
		<div class="section-label">Projects</div>
		<nav>
			{#each projects as project}
				<button
					class:active={selectedProject?.id === project.id}
					onclick={() => chooseProject(project)}
				>
					<span class="project-dot"></span><span>{project.name}</span>
				</button>
			{/each}
		</nav>
		<form class="add-project" onsubmit={addProject}>
			<input bind:value={projectName} placeholder="Project name" aria-label="Project name" />
			<input
				bind:value={projectRoot}
				placeholder="/absolute/project/path"
				aria-label="Project root path"
			/>
			<button type="submit">Add project</button>
		</form>
	</aside>

	<aside
		id="session-drawer"
		class="context-panel"
		class:open={mobileDrawer === 'sessions'}
		aria-label="Project contents"
	>
		<header>
			<div>
				<small>Selected project</small>
				<h1>{selectedProject?.name ?? 'No project'}</h1>
			</div>
			{#if activeTab === 'sessions' && selectedProject}<button
					class="icon-button"
					onclick={createSession}
					aria-label="New session">+</button
				>{/if}
		</header>
		<div class="tabs" role="tablist">
			<button class:active={activeTab === 'sessions'} onclick={() => changeTab('sessions')}
				>Sessions</button
			>
			<button class:active={activeTab === 'workflows'} onclick={() => changeTab('workflows')}
				>Workflows</button
			>
		</div>
		{#if loading}<p class="muted padded">Loading on demand…</p>{/if}
		{#if activeTab === 'sessions'}
			<div class="item-list">
				{#each sessions as session}
					<button
						class:active={selectedSession?.sessionId === session.sessionId}
						onclick={() => openSession(session)}
					>
						<strong>{session.title || 'Untitled session'}</strong>
						<small
							>{session.updatedAt
								? new Date(session.updatedAt).toLocaleString()
								: 'New session'}</small
						>
					</button>
				{/each}
				{#if !loading && selectedProject && sessions.length === 0}<p class="empty">
						No persisted Hermes Sessions yet.
					</p>{/if}
			</div>
		{:else}
			<div class="item-list">
				{#each workflows as workflow}
					<article class="workflow-card">
						<div>
							<strong>{workflow.name}</strong>
							<p>{workflow.prompt}</p>
						</div>
						<button onclick={() => runWorkflow(workflow)}>Run</button>
					</article>
				{/each}
			</div>
			<form class="workflow-form" onsubmit={addWorkflow}>
				<input bind:value={workflowName} placeholder="Workflow name" aria-label="Workflow name" />
				<textarea
					bind:value={workflowPrompt}
					placeholder="Reusable Hermes prompt"
					aria-label="Workflow prompt"></textarea>
				<button type="submit">Save workflow</button>
			</form>
		{/if}
	</aside>

	<main class="session-view">
		<header class="session-header">
			<div>
				<small>{selectedProject?.rootPath ?? 'Choose a Project'}</small>
				<h2>
					{selectedSession?.title ||
						(selectedSession ? 'New Hermes Session' : 'Projects · Workflows · Sessions')}
				</h2>
			</div>
			<div class="runtime-pill"><span></span> Hermes ACP</div>
		</header>
		{#if error}<div class="error" role="alert">{error}</div>{/if}
		{#if selectedSession}
			<section class="transcript" aria-live="polite">
				{#each transcript as message}
					<article
						class:assistant={message.role === 'assistant'}
						class:user={message.role === 'user'}
					>
						<div class="avatar">{message.role === 'assistant' ? 'H' : 'You'}</div>
						{#if message.role === 'assistant'}
							<div class="message markdown">{@html renderMarkdown(message.text)}</div>
						{:else}
							<p class="message">{message.text}</p>
						{/if}
					</article>
				{/each}
				{#if pendingAssistant}<article class="assistant">
						<div class="avatar">H</div>
						<div class="message markdown">
							{@html renderMarkdown(
								pendingAssistant
							)}{#if delivery === 'accepted' || delivery === 'running'}<span class="cursor">▋</span
								>{/if}
						</div>
					</article>{/if}
				{#if transcript.length === 0 && !pendingAssistant}<div class="welcome">
						<span>H</span>
						<h2>Start this Hermes Session</h2>
						<p>Your complete message is saved before HUE sends it.</p>
					</div>{/if}
			</section>
			<form class="composer" onsubmit={submitMessage}>
				<textarea
					value={composer}
					oninput={updateDraft}
					disabled={isTurnBusy(delivery)}
					placeholder="Message Hermes…"
					aria-label="Message Hermes"></textarea>
				<div>
					<small class:warning={delivery.includes('unknown')}
						>{delivery || 'Complete-envelope delivery'}</small
					>{#if pendingEnvelope}<button
							type="button"
							class="retry-message"
							onclick={retryPendingMessage}
							disabled={isTurnBusy(delivery)}>Retry exact message</button
						>{:else}<button type="submit" disabled={!composer.trim() || isTurnBusy(delivery)}
							>Send</button
						>{/if}
				</div>
			</form>
		{:else}
			<section class="hero">
				<div class="hero-mark">H</div>
				<h2>A smaller, faster Hermes workspace.</h2>
				<p>
					Select a Project to load only its Sessions, or save a reusable Workflow. Nothing else is
					hiding behind the interface.
				</p>
				<div class="principles">
					<span>Local SQLite</span><span>ACP v1</span><span>No PTY</span><span
						>Reconnect cursors</span
					>
				</div>
			</section>
		{/if}
	</main>
</div>
