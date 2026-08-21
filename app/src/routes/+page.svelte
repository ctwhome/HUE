<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { marked } from 'marked';
	import sanitizeHtml from 'sanitize-html';
	import {
		applySessionEvents,
		isCurrentSessionRequest,
		isCurrentTabRequest,
		isTurnBusy,
		runSingleFlight
	} from '$lib';
	import type { ImageAttachment } from '$lib/message-content';
	import type { PageData } from './$types';

	type Project = PageData['projects'][number];
	type Session = {
		sessionId: string;
		cwd: string;
		title?: string | null;
		updatedAt?: string | null;
	};
	type Workflow = { id: string; name: string; prompt: string; profile: string };
	type HermesCommand = { name: string; description: string; input?: { hint: string } | null };
	type TranscriptMessage = {
		role: 'user' | 'assistant';
		text: string;
		images?: ImageAttachment[];
	};
	type SessionEvent = { sequence: number; type: string; payload: Record<string, unknown> };
	type PendingEnvelope = {
		id: string;
		projectId: string;
		sessionId: string;
		text: string;
		images: ImageAttachment[];
	};
	type ActiveTurn = {
		messageId: string;
		status: 'queued' | 'running' | 'unknown';
		output: string;
		error: string | null;
	};
	type Directory = { name: string; path: string };
	type DirectoryListing = Directory & { parent: string | null; entries: Directory[] };

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
	let projectRoot = $state('');
	let projectDirectoryName = $state('');
	let projectDirectories = $state<Directory[]>([]);
	let projectDirectoryParent = $state<string | null>(null);
	let showHiddenDirectories = $state(false);
	let directoryLoading = $state(false);
	let directoryError = $state('');
	let addProjectDialog: HTMLDialogElement;
	let workflowName = $state('');
	let workflowPrompt = $state('');
	let composer = $state('');
	let commands = $state<HermesCommand[]>([]);
	let commandIndex = $state(0);
	let images = $state<ImageAttachment[]>([]);
	let draggingImages = $state(false);
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
		commands = [];
		images = [];
		error = '';
		mobileDrawer = 'sessions';
		persistSelection();
		await loadActiveTab();
	}

	function persistSelection() {
		const url = new URL(window.location.href);
		if (selectedProject) url.searchParams.set('project', selectedProject.id);
		else url.searchParams.delete('project');
		if (selectedSession) url.searchParams.set('session', selectedSession.sessionId);
		else url.searchParams.delete('session');
		replaceState(url, page.state);
	}

	async function restoreSelection() {
		const params = new URL(window.location.href).searchParams;
		const project = projects.find(({ id }) => id === params.get('project')) ?? selectedProject;
		selectedProject = project ?? null;
		await loadActiveTab();
		const session = sessions.find(({ sessionId }) => sessionId === params.get('session'));
		if (session) await openSession(session);
		else persistSelection();
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

	function openAddProject() {
		directoryError = '';
		addProjectDialog.showModal();
		void loadDirectory();
	}

	async function loadDirectory(path?: string, showHidden = showHiddenDirectories) {
		directoryLoading = true;
		directoryError = '';
		try {
			const query = new URLSearchParams({ hidden: String(showHidden) });
			if (path) query.set('path', path);
			const directory = await api<DirectoryListing>(`/api/directories?${query}`);
			projectRoot = directory.path;
			projectDirectoryName = directory.name;
			projectDirectoryParent = directory.parent;
			projectDirectories = directory.entries;
			await tick();
			addProjectDialog.querySelector<HTMLButtonElement>('.directory-row, .add-project button')?.focus();
		} catch (cause) {
			directoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			directoryLoading = false;
		}
	}

	function toggleHiddenDirectories(event: Event) {
		showHiddenDirectories = (event.currentTarget as HTMLInputElement).checked;
		void loadDirectory(projectRoot, showHiddenDirectories);
	}

	async function addProject(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			const body = await api<{ project: Project }>('/api/projects', {
				method: 'POST',
				body: JSON.stringify({ name: projectDirectoryName, rootPath: projectRoot })
			});
			projects = [...projects, body.project];
			projectRoot = '';
			addProjectDialog.close();
			await chooseProject(body.project);
		} catch (cause) {
			directoryError = cause instanceof Error ? cause.message : String(cause);
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
			persistSelection();
			transcript = [];
			commands = [];
			images = [];
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
		persistSelection();
		loading = true;
		error = '';
		try {
			const body = await api<{
				transcript: TranscriptMessage[];
				transcriptError?: string;
				cursor: number;
				activeTurn: ActiveTurn | null;
				commands?: HermesCommand[];
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
			commands = body.commands ?? [];
			images = [];
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
			error = body.transcriptError ?? '';
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
		if (!text.trim() && !images.length) return;
		if (await sendText(text)) {
			composer = '';
			images = [];
			clearCurrentDraft();
		}
	}

	async function sendText(text: string, attachments: ImageAttachment[] = images): Promise<boolean> {
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
						text,
						images: attachments
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
					body: JSON.stringify({ messageId, text: envelope.text, images: envelope.images })
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
			transcript = [...transcript, { role: 'user', text, images: envelope.images }];
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
		if (await sendText(pendingEnvelope.text, pendingEnvelope.images)) {
			composer = '';
			images = [];
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
		commandIndex = 0;
		saveCurrentDraft();
	}

	function matchingCommands() {
		const match = composer.match(/^\/([^\s]*)$/);
		if (!match) return [];
		return commands.filter(({ name }) => name.toLowerCase().startsWith(match[1].toLowerCase()));
	}

	function chooseCommand(command: HermesCommand) {
		composer = `/${command.name} `;
		commandIndex = 0;
		saveCurrentDraft();
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		const matches = matchingCommands();
		if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			commandIndex = (commandIndex + step + matches.length) % matches.length;
			return;
		}
		if (matches.length && (event.key === 'Tab' || event.key === 'Enter')) {
			event.preventDefault();
			chooseCommand(matches[commandIndex] ?? matches[0]);
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	}

	async function addImageFiles(files: FileList | File[]) {
		for (const file of Array.from(files).slice(0, 4 - images.length)) {
			if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
				error = 'Only PNG, JPEG, GIF, and WebP images are supported';
				continue;
			}
			if (file.size > 10 * 1024 * 1024) {
				error = 'Each image must be 10 MB or smaller';
				continue;
			}
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
			images = [...images, { name: file.name, mimeType: file.type, data: dataUrl.split(',')[1] }];
		}
	}

	function handleImageInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files) void addImageFiles(input.files);
		input.value = '';
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		draggingImages = false;
		if (event.dataTransfer?.files) void addImageFiles(event.dataTransfer.files);
	}

	function handlePaste(event: ClipboardEvent) {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length) void addImageFiles(files);
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

	onMount(() => void restoreSelection());
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
			<a
				class="docs-link"
				href="/docs/"
				target="_blank"
				aria-label="Open documentation in a new tab"
				title="Documentation"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H4V5.5Z" />
					<path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17a2 2 0 0 1 2-2h5V5.5Z" />
				</svg>
			</a>
		</header>
		<div class="section-heading">
			<span class="section-label">Projects</span>
			<button
				class="icon-button"
				aria-label="Add project"
				onclick={openAddProject}>+</button
			>
		</div>
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
		<dialog
			bind:this={addProjectDialog}
			class="add-project-dialog"
			aria-labelledby="add-project-title"
			onclick={(event) => event.target === event.currentTarget && addProjectDialog.close()}
		>
			<header>
				<div>
					<h2 id="add-project-title">Add project directory</h2>
					<p>Choose a folder to add as a project.</p>
				</div>
				<label>
					<input
						type="checkbox"
						checked={showHiddenDirectories}
						onchange={toggleHiddenDirectories}
					/>
					Show hidden
				</label>
			</header>
			<div class="directory-location">
				<button
					disabled={!projectDirectoryParent || directoryLoading}
					onclick={() => projectDirectoryParent && loadDirectory(projectDirectoryParent)}
					aria-label="Parent directory">↑</button
				>
				<code>{projectRoot || 'Loading…'}</code>
			</div>
			<section class="directory-browser" aria-label="Directories">
				<strong>Directories</strong>
				{#if directoryLoading}<p class="muted">Loading directories…</p>
				{:else if directoryError}<p class="directory-error" role="alert">{directoryError}</p>
				{:else if projectDirectories.length === 0}<p class="muted">No subdirectories.</p>
				{:else}{#each projectDirectories as directory}
						<button class="directory-row" onclick={() => loadDirectory(directory.path)}>
							<span aria-hidden="true">□</span><span>{directory.name}</span><small
								>{projects.some((project) => project.rootPath === directory.path)
									? 'Added'
									: '+'}</small
							>
						</button>
					{/each}{/if}
			</section>
			<form class="add-project" onsubmit={addProject}>
				<button
					type="submit"
					disabled={directoryLoading ||
						!projectRoot ||
						projects.some((project) => project.rootPath === projectRoot)}
					>{projects.some((project) => project.rootPath === projectRoot)
						? 'Already added'
						: 'Add this directory'}</button
				>
			</form>
			<button
				class="icon-button"
				aria-label="Close add project"
				onclick={() => addProjectDialog.close()}>×</button
			>
		</dialog>
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
			<div class="context-actions">
				<span
					class="loading-indicator"
					class:active={loading}
					role="status"
					aria-label="Loading project contents"
					aria-hidden={!loading}
				></span>
				{#if activeTab === 'sessions' && selectedProject}<button
						class="icon-button"
						onclick={createSession}
						aria-label="New session">+</button
					>{/if}
			</div>
		</header>
		<div class="tabs" role="tablist">
			<button class:active={activeTab === 'sessions'} onclick={() => changeTab('sessions')}
				>Sessions</button
			>
			<button class:active={activeTab === 'workflows'} onclick={() => changeTab('workflows')}
				>Workflows</button
			>
		</div>
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
							<div class="message user-message">
								{#if message.images?.length}<div class="message-images">
										{#each message.images as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{#if message.text}<p>{message.text}</p>{/if}
							</div>
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
			<form
				class="composer"
				class:dragging={draggingImages}
				onsubmit={submitMessage}
				ondragover={(event) => {
					event.preventDefault();
					draggingImages = true;
				}}
				ondragleave={() => (draggingImages = false)}
				ondrop={handleDrop}
			>
				{#if matchingCommands().length}<div
						class="command-menu"
						role="listbox"
						aria-label="Hermes commands"
					>
						{#each matchingCommands() as command, index}<button
								type="button"
								role="option"
								aria-selected={index === commandIndex}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => chooseCommand(command)}
							>
								<strong>/{command.name}{command.input ? ` ${command.input.hint}` : ''}</strong>
								<span>{command.description}</span>
							</button>{/each}
					</div>{/if}
				{#if images.length}<div class="attachment-list">
						{#each images as image, index}<figure>
								<img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
								<figcaption>{image.name}</figcaption>
								<button
									type="button"
									aria-label={`Remove ${image.name}`}
									onclick={() => (images = images.filter((_, item) => item !== index))}>×</button
								>
							</figure>{/each}
					</div>{/if}
				<textarea
					value={composer}
					oninput={updateDraft}
					onkeydown={handleComposerKeydown}
					onpaste={handlePaste}
					disabled={isTurnBusy(delivery)}
					placeholder="Message Hermes…"
					aria-label="Message Hermes"></textarea>
				<div class="composer-toolbar">
					<label class="attach-button" aria-label="Attach images" title="Attach images">
						<span aria-hidden="true">+</span>
						<input
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							multiple
							onchange={handleImageInput}
						/>
					</label>
					<small class:warning={delivery.includes('unknown')}
						>{delivery || (commands.length ? 'Type / for Hermes commands' : 'Complete-envelope delivery')}</small
					>{#if pendingEnvelope}<button
							type="button"
							class="retry-message"
							onclick={retryPendingMessage}
							disabled={isTurnBusy(delivery)}>Retry exact message</button
						>{:else}<button
							type="submit"
							disabled={(!composer.trim() && !images.length) || isTurnBusy(delivery)}
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
