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
		formatElapsed,
		isTurnBusy,
		runSingleFlight,
		subagentTreesFromEvents,
		type WorkspaceSubagentTree
	} from '$lib';
	import type { ImageAttachment } from '$lib/message-content';
	import type { PageData } from './$types';

	type Project = PageData['projects'][number];
	type Session = {
		sessionId: string;
		cwd: string;
		title?: string | null;
		updatedAt?: string | null;
		busySince?: string | null;
	};
	type Workflow = { id: string; name: string; prompt: string; profile: string };
	type HermesCommand = { name: string; description: string; input?: { hint: string } | null };
	type HermesRuntime = {
		profile: string;
		models?: {
			currentModelId: string;
			availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
		} | null;
		modes?: {
			currentModeId: string;
			availableModes: Array<{ id: string; name: string; description?: string | null }>;
		} | null;
		usage?: { used: number; size: number };
	};
	type HermesInfo = {
		profile: string;
		protocolVersion?: number;
		agent?: { name: string; version: string };
		capabilities?: Record<string, unknown>;
	};
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
	type QueuedMessage = {
		id: string;
		text: string;
		images: ImageAttachment[];
		status: 'queued';
	};
	type ActiveTurn = {
		messageId: string;
		status: 'queued' | 'running' | 'unknown';
		thought: string;
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
	let subagents = $state<WorkspaceSubagentTree[]>([]);
	let transcriptElement = $state<HTMLElement>();
	let composerElement = $state<HTMLTextAreaElement>();
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
	let hermesDialog: HTMLDialogElement;
	let hermesInfo = $state<HermesInfo | null>(null);
	let hermesLoading = $state(false);
	let hermesError = $state('');
	let workflowName = $state('');
	let workflowPrompt = $state('');
	let composer = $state('');
	let commands = $state<HermesCommand[]>([]);
	let runtime = $state<HermesRuntime>({ profile: 'default' });
	let branch = $state<string | null>(null);
	let runtimeChanging = $state(false);
	let commandIndex = $state(0);
	let images = $state<ImageAttachment[]>([]);
	let draggingImages = $state(false);
	let delivery = $state('');
	let pendingAssistant = $state('');
	let pendingThought = $state('');
	let eventCursor = $state(0);
	let activeMessageId = $state('');
	let pendingEnvelope = $state<PendingEnvelope | null>(null);
	let queuedMessages = $state<QueuedMessage[]>([]);
	let editingQueuedMessageId = $state('');
	let stopping = $state(false);
	let mobileDrawer = $state<'projects' | 'sessions' | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;
	let now = $state(Date.now());
	let sessionRequestGeneration = 0;
	let tabRequestGeneration = 0;
	let hermesRequestGeneration = 0;
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
		subagents = [];
		commands = [];
		runtime = { profile: 'default' };
		branch = null;
		queuedMessages = [];
		editingQueuedMessageId = '';
		images = [];
		error = '';
		mobileDrawer = 'sessions';
		persistSelection();
		await loadActiveTab();
	}

	async function openHermesInspector() {
		const request = ++hermesRequestGeneration;
		mobileDrawer = null;
		hermesDialog.showModal();
		hermesLoading = true;
		hermesError = '';
		try {
			const info = await api<HermesInfo>('/api/hermes');
			if (request === hermesRequestGeneration) hermesInfo = info;
		} catch (cause) {
			if (request === hermesRequestGeneration) {
				hermesError = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request === hermesRequestGeneration) hermesLoading = false;
		}
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
			directoryLoading = false;
			await tick();
			addProjectDialog
				.querySelector<HTMLButtonElement>('.directory-row, .add-project button')
				?.focus();
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
			const body = await api<{
				session: Session;
				commands?: HermesCommand[];
				runtime?: HermesRuntime;
				branch?: string | null;
			}>(`/api/projects/${selectedProject.id}/sessions`, { method: 'POST' });
			sessions = [body.session, ...sessions];
			selectedSession = body.session;
			persistSelection();
			transcript = [];
			subagents = [];
			commands = body.commands ?? [];
			runtime = body.runtime ?? { profile: 'default' };
			branch = body.branch ?? null;
			images = [];
			queuedMessages = [];
			editingQueuedMessageId = '';
			pendingAssistant = '';
			pendingThought = '';
			activeMessageId = '';
			delivery = '';
			pendingEnvelope = null;
			error = '';
			eventCursor = 0;
			restoreDraft();
			mobileDrawer = null;
			await tick();
			composerElement?.focus();
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
				events: SessionEvent[];
				messages: Array<QueuedMessage | { id: string; status: string }>;
				commands?: HermesCommand[];
				runtime?: HermesRuntime;
				branch?: string | null;
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
			subagents = subagentTreesFromEvents(body.events ?? []);
			commands = body.commands ?? [];
			runtime = body.runtime ?? { profile: 'default' };
			branch = body.branch ?? null;
			queuedMessages = body.messages.filter(
				(message): message is QueuedMessage =>
					message.status === 'queued' && message.id !== body.activeTurn?.messageId
			);
			editingQueuedMessageId = '';
			images = [];
			eventCursor = body.cursor;
			activeMessageId = body.activeTurn?.messageId ?? '';
			pendingAssistant = body.activeTurn?.output ?? '';
			pendingThought = body.activeTurn?.thought ?? '';
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
			await scrollLatestQuestionToTop();
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
		const text = composer;
		if (!text.trim() && !images.length) return;
		const sent = editingQueuedMessageId
			? await updateQueuedMessage(text)
			: isTurnBusy(delivery)
				? await queueMessage(text)
				: await sendText(text);
		if (sent) {
			composer = '';
			images = [];
			editingQueuedMessageId = '';
			clearCurrentDraft();
		}
	}

	async function queueMessage(text: string): Promise<boolean> {
		if (!selectedProject || !selectedSession) return false;
		const messageId = crypto.randomUUID();
		try {
			await api<{ status: string }>(
				`/api/projects/${selectedProject.id}/sessions/${selectedSession.sessionId}/messages`,
				{
					method: 'POST',
					body: JSON.stringify({ messageId, text, images })
				}
			);
			queuedMessages = [
				...queuedMessages,
				{ id: messageId, text, images: [...images], status: 'queued' }
			];
			return true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			return false;
		}
	}

	async function updateQueuedMessage(text: string): Promise<boolean> {
		if (!selectedProject || !selectedSession || !editingQueuedMessageId) return false;
		try {
			const body = await api<{ message: QueuedMessage }>(
				`/api/projects/${selectedProject.id}/sessions/${selectedSession.sessionId}/messages`,
				{
					method: 'PATCH',
					body: JSON.stringify({ messageId: editingQueuedMessageId, text, images })
				}
			);
			queuedMessages = queuedMessages.map((message) =>
				message.id === editingQueuedMessageId ? body.message : message
			);
			return true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			return false;
		}
	}

	async function editQueuedMessage(message: QueuedMessage) {
		editingQueuedMessageId = message.id;
		composer = message.text;
		images = [...message.images];
		await tick();
		composerElement?.focus();
	}

	async function stopTurn() {
		if (!selectedProject || !selectedSession || stopping) return;
		stopping = true;
		try {
			await api(
				`/api/projects/${selectedProject.id}/sessions/${selectedSession.sessionId}/cancel`,
				{
					method: 'POST'
				}
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			stopping = false;
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
		pendingThought = '';
		delivery = 'saving';
		setSessionBusySince(session.sessionId, new Date().toISOString());
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
			await scrollLatestQuestionToTop();
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
			setSessionBusySince(session.sessionId, null);
			error = cause instanceof Error ? cause.message : String(cause);
			return false;
		}
	}

	async function scrollLatestQuestionToTop() {
		await tick();
		const latestQuestion = transcriptElement?.querySelector<HTMLElement>(
			'article.user:not(:has(~ article.user))'
		);
		if (transcriptElement && latestQuestion) {
			transcriptElement.scrollTop +=
				latestQuestion.getBoundingClientRect().top - transcriptElement.getBoundingClientRect().top;
		}
	}

	function setSessionBusySince(sessionId: string, busySince: string | null) {
		sessions = sessions.map((session) =>
			session.sessionId === sessionId ? { ...session, busySince } : session
		);
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
			const saved = pending
				? (JSON.parse(localStorage.getItem(pending) ?? 'null') as PendingEnvelope | null)
				: null;
			pendingEnvelope = saved ? { ...saved, images: saved.images ?? [] } : null;
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

	function contextPercent() {
		if (!runtime.usage?.size) return null;
		return Math.max(0, Math.min(100, Math.round((runtime.usage.used / runtime.usage.size) * 100)));
	}

	async function changeRuntime(kind: 'modelId' | 'modeId', event: Event) {
		if (!selectedProject || !selectedSession) return;
		runtimeChanging = true;
		try {
			const value = (event.currentTarget as HTMLSelectElement).value;
			const body = await api<{ runtime: HermesRuntime }>(
				`/api/projects/${selectedProject.id}/sessions/${selectedSession.sessionId}`,
				{ method: 'PATCH', body: JSON.stringify({ [kind]: value }) }
			);
			runtime = { ...runtime, ...body.runtime };
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			runtimeChanging = false;
		}
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
				const body = await api<{ events: SessionEvent[]; runtime?: HermesRuntime }>(
					`/api/projects/${projectId}/sessions/${sessionId}/events?after=${eventCursor}`
				);
				if (selectedProject?.id !== projectId || selectedSession?.sessionId !== sessionId) return;
				const next = applySessionEvents(
					{
						cursor: eventCursor,
						activeMessageId,
						pendingAssistant,
						pendingThought,
						delivery,
						transcript,
						subagents
					},
					body.events
				);
				eventCursor = next.cursor;
				pendingAssistant = next.pendingAssistant;
				pendingThought = next.pendingThought ?? '';
				delivery = next.delivery;
				transcript = next.transcript;
				subagents = next.subagents ?? [];
				if (body.runtime) runtime = { ...runtime, ...body.runtime };
				if (!isTurnBusy(delivery)) {
					setSessionBusySince(sessionId, null);
					if (queuedMessages.length && selectedSession) await openSession(selectedSession);
					else stopPolling();
				}
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

	onMount(() => {
		elapsedTimer = setInterval(() => (now = Date.now()), 1000);
		void restoreSelection();
	});
	onDestroy(() => {
		stopPolling();
		if (elapsedTimer) clearInterval(elapsedTimer);
	});
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (mobileDrawer = null)} />

<svelte:head>
	<title>HUE Workspace</title>
	<meta name="description" content="Projects, Workflows, and reliable Hermes Sessions." />
</svelte:head>

<div class="workspace">
	<nav class="global-rail" aria-label="Global navigation">
		<span class="global-mark" aria-hidden="true">H</span>
		<a
			class="global-action active"
			href="/"
			aria-label="Workspace"
			aria-current="page"
			title="Workspace"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M5 5h14v11H9l-4 3V5Z" />
			</svg>
		</a>
		<button
			class="global-action runtime-inspector-button"
			aria-label="Inspect Hermes runtime"
			title="Hermes runtime"
			onclick={openHermesInspector}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
			</svg>
		</button>
		<button
			class="global-action"
			aria-label="Schedules"
			title="Schedules"
			onclick={openHermesInspector}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M5 4v3M19 4v3M4 9h16M5 6h14v14H5V6Z" />
			</svg>
		</button>
		<button class="global-action" aria-label="Skills" title="Skills" onclick={openHermesInspector}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z" />
			</svg>
		</button>
		<button
			class="global-action"
			aria-label="Commands"
			title="Session commands"
			onclick={openHermesInspector}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="m8 7-4 5 4 5M16 7l4 5-4 5M13 5l-2 14" />
			</svg>
		</button>
		<button
			class="global-action"
			aria-label="Profiles"
			title="Profiles"
			onclick={openHermesInspector}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="8" r="3" /><path d="M5 20c0-4 3-7 7-7s7 3 7 7" />
			</svg>
		</button>
		<a
			class="global-action global-docs"
			href="/docs/"
			target="_blank"
			aria-label="Open documentation in a new tab"
			title="Documentation"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M6 3h9l4 4v14H6V3Z" /><path d="M15 3v5h4M9 12h7M9 16h7" />
			</svg>
		</a>
	</nav>
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
		<button aria-label="Inspect Hermes runtime" onclick={openHermesInspector}>Hermes</button>
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
		<div class="section-heading">
			<span class="section-label">Projects</span>
			<button class="icon-button" aria-label="Add project" onclick={openAddProject}>+</button>
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
							<span class="folder-icon" aria-hidden="true"></span><span>{directory.name}</span
							><small
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
		<dialog
			bind:this={hermesDialog}
			class="hermes-dialog"
			aria-labelledby="hermes-dialog-title"
			onclick={(event) => event.target === event.currentTarget && hermesDialog.close()}
		>
			<header>
				<div>
					<h2 id="hermes-dialog-title">Hermes runtime</h2>
					<p>Live information exposed through the supported ACP connection.</p>
				</div>
				<button
					class="icon-button"
					aria-label="Close Hermes runtime"
					onclick={() => hermesDialog.close()}>×</button
				>
			</header>
			{#if hermesLoading}<p class="muted" role="status">Connecting to Hermes…</p>
			{:else if hermesError}<p class="directory-error" role="alert">{hermesError}</p>
			{:else if hermesInfo}<div class="hermes-sections">
					<section>
						<h3>Profile</h3>
						<strong>{hermesInfo.profile}</strong>
						<p>The profile configured for this HUE runtime.</p>
					</section>
					<section>
						<h3>Agent</h3>
						<strong
							>{hermesInfo.agent
								? `${hermesInfo.agent.name} ${hermesInfo.agent.version}`
								: 'Hermes ACP'}</strong
						>
						<p>ACP protocol v{hermesInfo.protocolVersion ?? 1}</p>
					</section>
					<section>
						<h3>Session commands</h3>
						{#if commands.length}<ul>
								{#each commands as command}<li>
										<strong>/{command.name}</strong>
										{command.description}
									</li>{/each}
							</ul>
						{:else}<p>Open a Session to inspect its advertised commands.</p>{/if}
					</section>
					<section>
						<h3>Skills</h3>
						<p>Skills are not exposed by Hermes ACP</p>
					</section>
					<section>
						<h3>Schedules</h3>
						<p>Schedules are not exposed by Hermes ACP</p>
					</section>
					{#if hermesInfo.capabilities}<details>
							<summary>ACP capabilities</summary>
							<pre>{JSON.stringify(hermesInfo.capabilities, null, 2)}</pre>
						</details>{/if}
				</div>{/if}
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
						<div class="session-row-title">
							<strong>{session.title || 'Untitled session'}</strong>
							{#if session.busySince}<span
									class="busy-timer"
									aria-label={`Busy for ${formatElapsed(session.busySince, now)}`}
									>{formatElapsed(session.busySince, now)}</span
								>{/if}
						</div>
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
				<small>
					{selectedProject?.rootPath ?? 'Choose a Project'}
					{#if branch}<span class="header-branch">{branch}</span>{/if}
				</small>
				<h2>
					{selectedSession?.title ||
						(selectedSession ? 'New Hermes Session' : 'Projects · Workflows · Sessions')}
				</h2>
			</div>
			<div class="runtime-pill"><span></span> Hermes ACP</div>
		</header>
		{#if error}<div class="error" role="alert">{error}</div>{/if}
		{#if selectedSession}
			<section
				class="transcript"
				class:turn-active={isTurnBusy(delivery)}
				aria-live="polite"
				bind:this={transcriptElement}
			>
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
				{#each subagents as tree (tree.id)}
					<details class="subagent-tree" aria-label={tree.title} open>
						<summary>
							<span class="subagent-tree-title">{tree.title}</span>
							<span class="subagent-status" class:active={tree.status === 'in_progress'}
								>{tree.status.replace('_', ' ')}</span
							>
						</summary>
						<div class="subagent-children">
							{#each tree.children as child (child.index)}
								<details class="subagent-child">
									<summary>
										<span class="subagent-branch" aria-hidden="true"></span>
										<span class="subagent-goal">{child.goal}</span>
										{#if child.role}<span class="subagent-role">@{child.role}</span>{/if}
										<span class="subagent-status" class:active={child.status === 'in_progress'}
											>{child.status.replace('_', ' ')}</span
										>
									</summary>
									{#if child.result}<div class="subagent-result">{child.result}</div>{/if}
								</details>
							{/each}
						</div>
					</details>
				{/each}
				{#if pendingThought}<details class="agent-thought" open>
						<summary>Hermes reasoning</summary>
						<div class="markdown">{@html renderMarkdown(pendingThought)}</div>
					</details>{/if}
				{#if pendingAssistant}<article class="assistant">
						<div class="avatar">H</div>
						<div class="message markdown">
							{@html renderMarkdown(
								pendingAssistant
							)}{#if delivery === 'accepted' || delivery === 'running'}<span class="cursor">▋</span
								>{/if}
						</div>
					</article>{/if}
				{#if transcript.length === 0 && !pendingAssistant && !pendingThought}<div class="welcome">
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
				{#if queuedMessages.length}<section class="message-queue" aria-label="Queued messages">
						<header><strong>Queued messages</strong><span>{queuedMessages.length}</span></header>
						{#each queuedMessages as message}<article>
								<div class="queued-copy">
									<span class="queue-handle" aria-hidden="true">⠿</span>
									<span>{message.text || `${message.images.length} image(s)`}</span>
									{#if message.images.length}<small>+{message.images.length} file(s)</small>{/if}
								</div>
								<div class="queue-actions">
									<span>Waiting</span>
									<button
										type="button"
										aria-label="Edit queued message"
										onclick={() => editQueuedMessage(message)}>Edit</button
									>
									<button type="button" aria-label="Send queued message now" onclick={stopTurn}
										>Send now</button
									>
								</div>
							</article>{/each}
					</section>{/if}
				{#if images.length}<div class="attachment-list">
						{#each images as image, index}<figure>
								<figcaption>{image.name}</figcaption>
								<img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
								<button
									type="button"
									aria-label={`Remove ${image.name}`}
									onclick={() => (images = images.filter((_, item) => item !== index))}>×</button
								>
							</figure>{/each}
					</div>{/if}
				<textarea
					bind:this={composerElement}
					value={composer}
					oninput={updateDraft}
					onkeydown={handleComposerKeydown}
					onpaste={handlePaste}
					placeholder={isTurnBusy(delivery)
						? 'Type a follow-up and press Enter to queue…'
						: 'Message Hermes… / for commands'}
					aria-label="Message Hermes"></textarea>
				<div class="composer-toolbar">
					<label class="attach-button" aria-label="Attach images" title="Attach images">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" />
						</svg>
						<input
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							multiple
							onchange={handleImageInput}
						/>
					</label>
					<div class="composer-context" aria-label="Hermes session context">
						<span class="context-chip context-profile" title="Active Hermes profile">
							<span aria-hidden="true">✣</span><span>{runtime.profile}</span>
						</span>
						{#if runtime.models}<label
								class="context-chip context-select context-model"
								title="Hermes model"
							>
								<span aria-hidden="true">◉</span>
								<select
									aria-label="Hermes model"
									value={runtime.models.currentModelId}
									disabled={runtimeChanging || isTurnBusy(delivery)}
									onchange={(event) => changeRuntime('modelId', event)}
								>
									{#each runtime.models.availableModels as model}<option value={model.modelId}
											>{model.name}</option
										>{/each}
								</select>
							</label>{/if}
						{#if runtime.modes}<label
								class="context-chip context-select context-mode"
								title="Hermes edit mode"
							>
								<span aria-hidden="true">◌</span>
								<select
									aria-label="Hermes mode"
									value={runtime.modes.currentModeId}
									disabled={runtimeChanging || isTurnBusy(delivery)}
									onchange={(event) => changeRuntime('modeId', event)}
								>
									{#each runtime.modes.availableModes as mode}<option value={mode.id}
											>{mode.name}</option
										>{/each}
								</select>
							</label>{/if}
						{#if contextPercent() !== null}<span
								class="context-chip context-usage"
								class:warning={contextPercent()! >= 80}
								title={`${runtime.usage!.used.toLocaleString()} of ${runtime.usage!.size.toLocaleString()} context tokens used`}
								>{contextPercent()}%</span
							>{/if}
					</div>
					{#if delivery}<small
							class="composer-delivery"
							class:warning={delivery.includes('unknown')}>{delivery}</small
						>{/if}
					{#if pendingEnvelope}<button
							type="button"
							class="retry-message"
							onclick={retryPendingMessage}
							disabled={isTurnBusy(delivery)}>Retry exact message</button
						>{:else if isTurnBusy(delivery)}<button
							type="button"
							class="composer-send stop-message"
							aria-label="Stop"
							title="Stop current turn"
							onclick={stopTurn}
							disabled={stopping}
						>
							<span aria-hidden="true"></span></button
						>{:else}<button
							type="submit"
							class="composer-send"
							aria-label="Send"
							title="Send message"
							disabled={!composer.trim() && !images.length}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m5 5 14 7-14 7 3-7-3-7Z" /><path d="M8 12h11" />
							</svg></button
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
