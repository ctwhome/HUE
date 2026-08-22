<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { marked } from 'marked';
	import sanitizeHtml from 'sanitize-html';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import {
		ArrowDown,
		ArrowLeft,
		ArrowUp,
		CalendarDays,
		Check,
		ChevronDown,
		ChevronRight,
		Circle,
		CircleDot,
		Code2,
		Diamond,
		Ellipsis,
		ExternalLink,
		FileText,
		Folder,
		Grid2X2,
		GripVertical,
		LoaderCircle,
		Mic,
		MicOff,
		MessageSquare,
		Minus,
		Paperclip,
		PhoneCall,
		Plus,
		Plug,
		RefreshCw,
		Send,
		Settings,
		SlidersHorizontal,
		Sparkles,
		Square,
		PhoneOff,
		UserRound,
		X
	} from 'lucide-svelte';
	import { Copy, GitFork, Pencil } from 'lucide-svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import { automaticSessionIcon } from '$lib/icon';
	import { highlightMarkdown } from '$lib/markdown-highlight';
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
	import { takeSpeakableText } from '$lib/voice-call';
	import type { PageData } from './$types';

	type Project = PageData['projects'][number];
	type Session = {
		sessionId: string;
		cwd: string;
		title?: string | null;
		icon?: string | null;
		customIcon?: string | null;
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
	type GlobalView =
		'settings' | 'runtime' | 'skills' | 'schedules' | 'commands' | 'profiles' | 'mcp';
	type HermesSkill = {
		name: string;
		category: string;
		source: string;
		trust?: string;
		status: string;
	};
	type HermesJob = {
		id: string;
		name?: string;
		schedule?: string;
		status: string;
		nextRun?: string;
		lastRun?: string;
	};
	type HermesProfile = { name: string; model: string; gateway: string; active: boolean };
	type HermesMcpServer = {
		name: string;
		transport: string;
		url: string | null;
		command: string | null;
		enabled: boolean;
	};
	type TranscriptMessage = {
		role: 'user' | 'assistant';
		text: string;
		images?: ImageAttachment[];
	};
	type SessionEvent = { sequence: number; type: string; payload: Record<string, unknown> };
	type PendingEnvelope = {
		id: string;
		projectId: string | null;
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
		images?: ImageAttachment[];
		error: string | null;
	};
	type CachedSessionView = {
		transcript: TranscriptMessage[];
		subagents: WorkspaceSubagentTree[];
		commands: HermesCommand[];
		runtime: HermesRuntime;
		branch: string | null;
		queuedMessages: QueuedMessage[];
		eventCursor: number;
		activeMessageId: string;
		pendingAssistant: string;
		pendingImages: ImageAttachment[];
		pendingThought: string;
		delivery: string;
	};
	type Directory = { name: string; path: string };
	type DirectoryListing = Directory & { parent: string | null; entries: Directory[] };
	type Repository = {
		isRepository: boolean;
		branch: string | null;
		changes: Array<{ path: string; index: string; worktree: string }>;
		worktrees: Array<{ path: string; branch: string | null; head: string }>;
		remotes: Array<{ name: string; webUrl: string | null }>;
	};
	type BrowserTab = { id: string; title: string; url: string; draft: string };
	type TerminalTab = {
		id: string;
		label: string;
		terminalId: string;
		cursor: number;
		inputSequence: number;
		status: 'starting' | 'running' | 'exited';
	};

	let { data }: { data: PageData } = $props();
	let projects = $state<Project[]>(untrack(() => [...data.projects]));
	let selectedProject = $state<Project | null>(untrack(() => data.projects[0] ?? null));
	let sessions = $state<Session[]>([]);
	let workflows = $state<Workflow[]>([]);
	let selectedSession = $state<Session | null>(null);
	let transcript = $state<TranscriptMessage[]>([]);
	let subagents = $state<WorkspaceSubagentTree[]>([]);
	let transcriptElement = $state<HTMLElement>();
	let followingTranscript = $state(true);
	let showScrollToLatest = $state(false);
	let automaticScrollUntil = 0;
	let transcriptSettleUntil = 0;
	let beginTranscriptEntryStick: (() => void) | null = null;
	let composerElement = $state<HTMLTextAreaElement>();
	let voiceStartElement = $state<HTMLButtonElement>();
	let voiceMessageElement = $state<HTMLButtonElement>();
	let callMuteElement = $state<HTMLButtonElement>();
	let voiceCancelElement = $state<HTMLButtonElement>();
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
	let editProjectDialog: HTMLDialogElement;
	let removeProjectDialog: HTMLDialogElement;
	let editingProject = $state<Project | null>(null);
	let projectName = $state('');
	let projectIcon = $state<string | null>(null);
	let projectEmojiPickerOpen = $state(false);
	let projectEditError = $state('');
	let projectSaving = $state(false);
	let editSessionDialog: HTMLDialogElement;
	let editingSession = $state<Session | null>(null);
	let sessionIcon = $state<string | null>(null);
	let sessionEmojiPickerOpen = $state(false);
	let sessionEditError = $state('');
	let sessionSaving = $state(false);
	let hermesInfo = $state<HermesInfo | null>(null);
	let hermesLoading = $state(false);
	let hermesError = $state('');
	let globalView = $state<GlobalView | null>(null);
	let hermesSkills = $state<HermesSkill[]>([]);
	let hermesJobs = $state<HermesJob[]>([]);
	let hermesProfiles = $state<HermesProfile[]>([]);
	let hermesMcpServers = $state<HermesMcpServer[]>([]);
	let hermesFilter = $state('');
	let hermesCategory = $state('all');
	let hermesSource = $state('all');
	let hermesStatus = $state('all');
	let hermesGroup = $state<'none' | 'category' | 'source'>('none');
	let scheduleGroup = $state<'none' | 'status'>('none');
	let selectedSkill = $state('');
	let skillContent = $state('');
	let skillSaving = $state(false);
	let skillSaved = $state(false);
	let skillHighlightElement = $state<HTMLElement>();
	let workflowName = $state('');
	let workflowPrompt = $state('');
	let composer = $state('');
	let commands = $state<HermesCommand[]>([]);
	let runtime = $state<HermesRuntime>({ profile: 'default' });
	let branch = $state<string | null>(null);
	let runtimeChanging = $state(false);
	let modelMenuOpen = $state(false);
	let modelPopover = $state<HTMLElement>();
	let commandIndex = $state(0);
	let images = $state<ImageAttachment[]>([]);
	let draggingImages = $state(false);
	let delivery = $state('');
	let pendingAssistant = $state('');
	let pendingImages = $state<ImageAttachment[]>([]);
	let pendingThought = $state('');
	let callActive = $state(false);
	let voiceMessageOnly = $state(false);
	let callMuted = $state(false);
	let callStatus = $state<'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'>('idle');
	let callError = $state('');
	let eventCursor = $state(0);
	let activeMessageId = $state('');
	let pendingEnvelope = $state<PendingEnvelope | null>(null);
	let queuedMessages = $state<QueuedMessage[]>([]);
	let editingQueuedMessageId = $state('');
	let stopping = $state(false);
	let mobileDrawer = $state<'projects' | 'sessions' | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;
	let callStream: MediaStream | null = null;
	let callStreamPromise: Promise<MediaStream> | null = null;
	let callRecorder: MediaRecorder | null = null;
	let callMonitor: ReturnType<typeof setInterval> | null = null;
	let callMonitorContext: AudioContext | null = null;
	let callSpeechContext: AudioContext | null = null;
	let callAudio: HTMLAudioElement | null = null;
	let callSpeechAbort: AbortController | null = null;
	let callTranscribeAbort: AbortController | null = null;
	let callGeneration = 0;
	const discardedRecorders = new WeakSet<MediaRecorder>();
	let voiceResponseText = '';
	let voiceSpokenOffset = 0;
	let voiceSpeechQueue = Promise.resolve();
	let now = $state(Date.now());
	let sessionRequestGeneration = 0;
	let tabRequestGeneration = 0;
	let hermesRequestGeneration = 0;
	let repositoryRequestGeneration = 0;
	let repository = $state<Repository | null>(null);
	let repositoryLoading = $state(false);
	let repositoryError = $state('');
	let browserTabs = $state<BrowserTab[]>([]);
	let activeBrowserTabId = $state('');
	let browserError = $state('');
	let terminalTabs = $state<TerminalTab[]>([]);
	let activeTerminalTabId = $state('');
	let terminalError = $state('');
	let terminalElement = $state<HTMLDivElement>();
	let repositoryBusy = $state(false);
	let repositoryMessage = $state('');
	let commitMessage = $state('');
	let terminalNotice = $state('');
	let messageNotice = $state('');
	const pollFlight: { current: Promise<void> | null } = { current: null };
	let terminalRenderer: Terminal | null = null;
	let terminalFit: FitAddon | null = null;
	let terminalResizeObserver: ResizeObserver | null = null;
	let terminalPollTimer: ReturnType<typeof setTimeout> | null = null;
	let terminalInputFlight = Promise.resolve();
	const sessionLists = new Map<string, Session[]>();
	const workflowLists = new Map<string, Workflow[]>();
	const sessionViews = new Map<string, CachedSessionView>();

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

	async function chooseProject(project: Project | null) {
		endVoiceCall(false);
		cacheCurrentSessionView();
		void closeProjectTerminals();
		saveCurrentDraft();
		sessionRequestGeneration += 1;
		stopPolling();
		selectedProject = project;
		if (!project) activeTab = 'sessions';
		selectedSession = null;
		sessions = sessionLists.get(project?.id ?? 'none') ?? [];
		workflows = project ? (workflowLists.get(project.id) ?? []) : [];
		pendingEnvelope = null;
		transcript = [];
		subagents = [];
		commands = [];
		runtime = { profile: 'default' };
		branch = null;
		repository = null;
		repositoryError = '';
		queuedMessages = [];
		editingQueuedMessageId = '';
		images = [];
		error = '';
		mobileDrawer = 'sessions';
		if (project) restoreBrowserTabs(project.id);
		persistSelection();
		await Promise.all([loadActiveTab(), loadRepository()]);
		if (project) {
			await tick();
			void addTerminalTab();
		}
	}

	async function createProjectlessSession() {
		await chooseProject(null);
		await createSession();
	}

	async function openHermesPanel(view: GlobalView) {
		endVoiceCall(false);
		const request = ++hermesRequestGeneration;
		mobileDrawer = null;
		globalView = view;
		hermesFilter = '';
		hermesCategory = 'all';
		hermesSource = 'all';
		hermesStatus = 'all';
		hermesGroup = 'none';
		scheduleGroup = 'none';
		selectedSkill = '';
		hermesLoading = false;
		hermesError = '';
		if (view === 'settings' || view === 'commands') return;
		hermesLoading = true;
		try {
			const result = await api<
				HermesInfo & {
					skills?: HermesSkill[];
					jobs?: HermesJob[];
					profiles?: HermesProfile[];
					servers?: HermesMcpServer[];
				}
			>(
				view === 'mcp'
					? '/api/hermes/mcp'
					: `/api/hermes${view === 'runtime' ? '' : `?view=${view}`}`
			);
			if (request !== hermesRequestGeneration) return;
			if (view === 'runtime') hermesInfo = result;
			if (view === 'skills') hermesSkills = result.skills ?? [];
			if (view === 'schedules') hermesJobs = result.jobs ?? [];
			if (view === 'profiles') hermesProfiles = result.profiles ?? [];
			if (view === 'mcp') hermesMcpServers = result.servers ?? [];
		} catch (cause) {
			if (request === hermesRequestGeneration) {
				hermesError = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request === hermesRequestGeneration) hermesLoading = false;
		}
	}

	const skillCategory = (skill: HermesSkill) => skill.category || 'Uncategorised';
	const inventoryLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
	const skillOptions = (key: 'category' | 'source' | 'status') =>
		[
			...new Set(
				hermesSkills.map((skill) => (key === 'category' ? skillCategory(skill) : skill[key]))
			)
		].sort((a, b) => a.localeCompare(b));

	function filteredSkills() {
		const query = hermesFilter.trim().toLowerCase();
		return hermesSkills.filter(
			(skill) =>
				(!query ||
					`${skill.name} ${skillCategory(skill)} ${skill.source} ${skill.status}`
						.toLowerCase()
						.includes(query)) &&
				(hermesCategory === 'all' || skillCategory(skill) === hermesCategory) &&
				(hermesSource === 'all' || skill.source === hermesSource) &&
				(hermesStatus === 'all' || skill.status === hermesStatus)
		);
	}

	function skillGroups() {
		const skills = filteredSkills();
		if (hermesGroup === 'none') return [{ name: '', skills }];
		return [
			...Map.groupBy(skills, (skill) =>
				inventoryLabel(hermesGroup === 'category' ? skillCategory(skill) : skill.source)
			).entries()
		]
			.map(([name, groupedSkills]) => ({ name, skills: groupedSkills }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	const jobStatuses = () =>
		[...new Set(hermesJobs.map((job) => job.status))].sort((a, b) => a.localeCompare(b));

	function filteredJobs() {
		const query = hermesFilter.trim().toLowerCase();
		return hermesJobs.filter(
			(job) =>
				(!query ||
					`${job.name || job.id} ${job.schedule || ''} ${job.status} ${job.nextRun || ''} ${job.lastRun || ''}`
						.toLowerCase()
						.includes(query)) &&
				(hermesStatus === 'all' || job.status === hermesStatus)
		);
	}

	function jobGroups() {
		const jobs = filteredJobs();
		if (scheduleGroup === 'none') return [{ name: '', jobs }];
		return [...Map.groupBy(jobs, (job) => inventoryLabel(job.status)).entries()]
			.map(([name, groupedJobs]) => ({ name, jobs: groupedJobs }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async function openSkill(name: string) {
		hermesLoading = true;
		hermesError = '';
		skillSaved = false;
		try {
			const skill = await api<{ name: string; content: string }>(
				`/api/hermes/skills/${encodeURIComponent(name)}`
			);
			selectedSkill = skill.name;
			skillContent = skill.content;
		} catch (cause) {
			hermesError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			hermesLoading = false;
		}
	}

	async function saveSkill() {
		if (!selectedSkill) return;
		skillSaving = true;
		skillSaved = false;
		hermesError = '';
		try {
			const skill = await api<{ name: string; content: string }>(
				`/api/hermes/skills/${encodeURIComponent(selectedSkill)}`,
				{ method: 'PUT', body: JSON.stringify({ content: skillContent }) }
			);
			skillContent = skill.content;
			skillSaved = true;
		} catch (cause) {
			hermesError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			skillSaving = false;
		}
	}

	function syncSkillEditorScroll(event: Event) {
		if (!skillHighlightElement) return;
		const textarea = event.currentTarget as HTMLTextAreaElement;
		skillHighlightElement.scrollTop = textarea.scrollTop;
		skillHighlightElement.scrollLeft = textarea.scrollLeft;
	}

	function persistSelection() {
		const url = new URL(window.location.href);
		url.searchParams.set('project', selectedProject?.id ?? 'none');
		if (selectedSession) url.searchParams.set('session', selectedSession.sessionId);
		else url.searchParams.delete('session');
		replaceState(url, page.state);
	}

	async function restoreSelection() {
		const params = new URL(window.location.href).searchParams;
		const requestedProject = params.get('project');
		const project =
			requestedProject === 'none'
				? null
				: (projects.find(({ id }) => id === requestedProject) ?? selectedProject);
		selectedProject = project ?? null;
		if (selectedProject) restoreBrowserTabs(selectedProject.id);
		await Promise.all([loadActiveTab(), loadRepository()]);
		const session = sessions.find(({ sessionId }) => sessionId === params.get('session'));
		if (session) await openSession(session);
		else {
			persistSelection();
			await tick();
			void addTerminalTab();
		}
	}

	async function loadRepository() {
		if (!selectedProject) return;
		const projectId = selectedProject.id;
		const request = ++repositoryRequestGeneration;
		repositoryLoading = true;
		repositoryError = '';
		try {
			const result = await api<Repository>(`/api/projects/${projectId}/repository`);
			if (request === repositoryRequestGeneration && selectedProject?.id === projectId) {
				repository = result;
				if (result.branch && !selectedSession) branch = result.branch;
			}
		} catch (cause) {
			if (request === repositoryRequestGeneration && selectedProject?.id === projectId) {
				repositoryError = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request === repositoryRequestGeneration) repositoryLoading = false;
		}
	}

	function browserStorageKey(projectId: string) {
		return `hue:browser:${projectId}`;
	}

	function newBrowserTab(): BrowserTab {
		return { id: crypto.randomUUID(), title: 'New tab', url: '', draft: '' };
	}

	function restoreBrowserTabs(projectId: string) {
		try {
			const saved = JSON.parse(
				localStorage.getItem(browserStorageKey(projectId)) ?? '[]'
			) as BrowserTab[];
			browserTabs = saved.filter(
				(tab) =>
					typeof tab.id === 'string' && typeof tab.url === 'string' && typeof tab.title === 'string'
			);
		} catch {
			browserTabs = [];
		}
		if (!browserTabs.length) browserTabs = [newBrowserTab()];
		browserTabs = browserTabs.map((tab) => ({ ...tab, draft: tab.url }));
		activeBrowserTabId = browserTabs[0].id;
		browserError = '';
	}

	function saveBrowserTabs() {
		if (!selectedProject) return;
		localStorage.setItem(
			browserStorageKey(selectedProject.id),
			JSON.stringify(browserTabs.map(({ id, title, url }) => ({ id, title, url })))
		);
	}

	function activeBrowserTab() {
		return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? browserTabs[0];
	}

	function updateBrowserDraft(event: Event) {
		const draft = (event.currentTarget as HTMLInputElement).value;
		browserTabs = browserTabs.map((tab) =>
			tab.id === activeBrowserTabId ? { ...tab, draft } : tab
		);
	}

	function navigateBrowser(event: SubmitEvent) {
		event.preventDefault();
		const tab = activeBrowserTab();
		if (!tab) return;
		try {
			if (!tab.draft.trim() || /\s/.test(tab.draft)) throw new Error();
			const url = new URL(/^https?:\/\//i.test(tab.draft) ? tab.draft : `http://${tab.draft}`);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
			browserTabs = browserTabs.map((item) =>
				item.id === tab.id
					? { ...item, title: url.hostname || 'Browser', url: url.href, draft: url.href }
					: item
			);
			browserError = '';
			saveBrowserTabs();
		} catch {
			browserError = 'Enter a valid http or https address';
		}
	}

	function addBrowserTab() {
		const tab = newBrowserTab();
		browserTabs = [...browserTabs, tab];
		activeBrowserTabId = tab.id;
		browserError = '';
		saveBrowserTabs();
	}

	function closeBrowserTab(event: MouseEvent | KeyboardEvent, id: string) {
		event.stopPropagation();
		const remaining = browserTabs.filter((tab) => tab.id !== id);
		browserTabs = remaining.length ? remaining : [newBrowserTab()];
		if (activeBrowserTabId === id) activeBrowserTabId = browserTabs[0].id;
		saveBrowserTabs();
	}

	function activeTerminalTab() {
		return terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0];
	}

	function mountTerminal() {
		if (!terminalElement) return;
		terminalResizeObserver?.disconnect();
		terminalRenderer?.dispose();
		terminalRenderer = new Terminal({
			cursorBlink: true,
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
			fontSize: 13,
			theme: { background: '#090b0f', foreground: '#e7e9ef', cursor: '#a78bfa' },
			scrollback: 5_000
		});
		terminalFit = new FitAddon();
		terminalRenderer.loadAddon(terminalFit);
		terminalRenderer.open(terminalElement);
		terminalRenderer.onData(sendTerminalInput);
		terminalRenderer.onResize(({ cols, rows }) => void resizeTerminal(cols, rows));
		terminalResizeObserver = new ResizeObserver(() => {
			try {
				terminalFit?.fit();
			} catch {
				// The panel may be between responsive layouts.
			}
		});
		terminalResizeObserver.observe(terminalElement);
		terminalFit.fit();
		terminalRenderer.focus();
	}

	async function addTerminalTab() {
		if (!selectedProject || selectedSession || !terminalElement) return;
		if (!terminalRenderer) mountTerminal();
		terminalError = '';
		try {
			const body = await api<{ terminalId: string; cursor: number; status: 'running' }>(
				`/api/projects/${selectedProject.id}/terminal`,
				{
					method: 'POST',
					body: JSON.stringify({
						action: 'create',
						cols: terminalRenderer?.cols ?? 80,
						rows: terminalRenderer?.rows ?? 24
					})
				}
			);
			const tab: TerminalTab = {
				id: crypto.randomUUID(),
				label: `Terminal ${terminalTabs.length + 1}`,
				terminalId: body.terminalId,
				cursor: body.cursor,
				inputSequence: 0,
				status: body.status
			};
			terminalTabs = [...terminalTabs, tab];
			activeTerminalTabId = tab.id;
			terminalRenderer?.reset();
			startTerminalPolling();
		} catch (cause) {
			terminalError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function chooseTerminalTab(id: string) {
		activeTerminalTabId = id;
		terminalRenderer?.reset();
		const tab = terminalTabs.find((item) => item.id === id);
		if (tab) {
			terminalTabs = terminalTabs.map((item) => (item.id === id ? { ...item, cursor: 0 } : item));
		}
		startTerminalPolling();
		terminalRenderer?.focus();
	}

	function closeTerminalTab(event: MouseEvent | KeyboardEvent, tab: TerminalTab) {
		event.stopPropagation();
		terminalTabs = terminalTabs.filter((item) => item.id !== tab.id);
		if (activeTerminalTabId === tab.id) {
			activeTerminalTabId = terminalTabs[0]?.id ?? '';
			terminalRenderer?.reset();
		}
		if (selectedProject) {
			void api(`/api/projects/${selectedProject.id}/terminal`, {
				method: 'POST',
				body: JSON.stringify({ action: 'close', terminalId: tab.terminalId })
			}).catch(() => undefined);
		}
		if (!terminalTabs.length) void addTerminalTab();
		else startTerminalPolling();
	}

	function sendTerminalInput(data: string) {
		if (!selectedProject) return;
		const projectId = selectedProject.id;
		const tab = activeTerminalTab();
		if (!tab) return;
		terminalInputFlight = terminalInputFlight
			.then(async () => {
				const current = terminalTabs.find((item) => item.id === tab.id);
				if (!current || current.status !== 'running') return;
				const sequence = current.inputSequence + 1;
				const send = () =>
					api(`/api/projects/${projectId}/terminal`, {
						method: 'POST',
						body: JSON.stringify({
							action: 'input',
							terminalId: current.terminalId,
							sequence,
							data
						})
					});
				try {
					await send();
				} catch {
					try {
						await send();
					} catch {
						const state = await api<{ inputSequence: number }>(
							`/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(current.terminalId)}&after=0`
						);
						if (state.inputSequence < sequence) await send();
					}
				}
				terminalTabs = terminalTabs.map((item) =>
					item.id === tab.id ? { ...item, inputSequence: sequence } : item
				);
			})
			.catch((cause) => {
				terminalTabs = terminalTabs.map((item) =>
					item.id === tab.id ? { ...item, status: 'exited' } : item
				);
				terminalError = cause instanceof Error ? cause.message : String(cause);
			});
	}

	async function resizeTerminal(cols: number, rows: number) {
		if (!selectedProject) return;
		const tab = activeTerminalTab();
		if (!tab) return;
		await api(`/api/projects/${selectedProject.id}/terminal`, {
			method: 'POST',
			body: JSON.stringify({ action: 'resize', terminalId: tab.terminalId, cols, rows })
		}).catch(() => undefined);
	}

	function startTerminalPolling() {
		if (terminalPollTimer) clearTimeout(terminalPollTimer);
		void pollTerminal();
	}

	async function pollTerminal() {
		if (!selectedProject || selectedSession) return;
		const projectId = selectedProject.id;
		const tab = activeTerminalTab();
		if (!tab) return;
		try {
			const body = await api<{
				output: string;
				cursor: number;
				inputSequence: number;
				reset: boolean;
				status: 'running' | 'exited';
			}>(
				`/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(tab.terminalId)}&after=${tab.cursor}`
			);
			if (selectedProject?.id !== projectId || activeTerminalTabId !== tab.id) return;
			if (body.reset) terminalRenderer?.reset();
			if (body.output) terminalRenderer?.write(body.output);
			terminalTabs = terminalTabs.map((item) =>
				item.id === tab.id
					? {
							...item,
							cursor: body.cursor,
							inputSequence: Math.max(item.inputSequence, body.inputSequence),
							status: body.status
						}
					: item
			);
			terminalPollTimer = setTimeout(pollTerminal, body.output ? 30 : 120);
		} catch (cause) {
			if (selectedProject?.id === projectId && activeTerminalTabId === tab.id) {
				terminalError = cause instanceof Error ? cause.message : String(cause);
				terminalPollTimer = setTimeout(pollTerminal, 1_000);
			}
		}
	}

	function suspendTerminal() {
		if (terminalPollTimer) clearTimeout(terminalPollTimer);
		terminalPollTimer = null;
		terminalResizeObserver?.disconnect();
		terminalResizeObserver = null;
		terminalRenderer?.dispose();
		terminalRenderer = null;
		terminalFit = null;
	}

	async function closeProjectTerminals() {
		const projectId = selectedProject?.id;
		const tabs = [...terminalTabs];
		suspendTerminal();
		terminalTabs = [];
		activeTerminalTabId = '';
		if (!projectId) return;
		await Promise.all(
			tabs.map((tab) =>
				fetch(`/api/projects/${projectId}/terminal`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'close', terminalId: tab.terminalId }),
					keepalive: true
				}).catch(() => undefined)
			)
		);
	}

	function repositoryLinks() {
		const url = repository?.remotes.find((remote) => remote.webUrl)?.webUrl;
		if (!url) return [];
		return [
			{ label: 'Repository', url },
			...(new URL(url).hostname === 'github.com'
				? [
						{ label: 'Pull requests', url: `${url}/pulls` },
						{ label: 'Issues', url: `${url}/issues` }
					]
				: [])
		];
	}

	function stagedChanges() {
		return repository?.changes.filter(({ index }) => index !== ' ' && index !== '?') ?? [];
	}

	function unstagedChanges() {
		return (
			repository?.changes.filter(({ index, worktree }) => index === '?' || worktree !== ' ') ?? []
		);
	}

	async function mutateRepository(operation: Record<string, string>): Promise<boolean> {
		if (!selectedProject || repositoryBusy) return false;
		repositoryBusy = true;
		repositoryError = '';
		repositoryMessage = '';
		try {
			repository = await api<Repository>(`/api/projects/${selectedProject.id}/repository`, {
				method: 'POST',
				body: JSON.stringify(operation)
			});
			repositoryMessage =
				operation.action === 'commit'
					? 'Committed'
					: operation.action === 'push'
						? 'Pushed'
						: 'Git status updated';
			if (operation.action === 'commit') commitMessage = '';
			return true;
		} catch (cause) {
			repositoryError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			repositoryBusy = false;
		}
	}

	async function commitAndPush() {
		if (await mutateRepository({ action: 'commit', message: commitMessage })) {
			await mutateRepository({ action: 'push' });
		}
	}

	function sessionApiPath(sessionId?: string, suffix = '') {
		const base = selectedProject ? `/api/projects/${selectedProject.id}/sessions` : '/api/sessions';
		return `${base}${sessionId ? `/${sessionId}` : ''}${suffix}`;
	}

	function sessionViewKey(sessionId: string) {
		return `${selectedProject?.id ?? 'none'}:${sessionId}`;
	}

	function cacheCurrentSessionView() {
		if (!selectedSession) return;
		sessionViews.set(sessionViewKey(selectedSession.sessionId), {
			transcript: [...transcript],
			subagents: [...subagents],
			commands: [...commands],
			runtime: { ...runtime },
			branch,
			queuedMessages: [...queuedMessages],
			eventCursor,
			activeMessageId,
			pendingAssistant,
			pendingImages: [...pendingImages],
			pendingThought,
			delivery
		});
	}

	function showCachedSessionView(session: Session) {
		const cached = sessionViews.get(sessionViewKey(session.sessionId));
		transcript = cached?.transcript ?? [];
		subagents = cached?.subagents ?? [];
		commands = cached?.commands ?? [];
		runtime = cached?.runtime ?? { profile: 'default' };
		branch = cached?.branch ?? null;
		queuedMessages = cached?.queuedMessages ?? [];
		eventCursor = cached?.eventCursor ?? 0;
		activeMessageId = cached?.activeMessageId ?? '';
		pendingAssistant = cached?.pendingAssistant ?? '';
		pendingImages = cached?.pendingImages ?? [];
		pendingThought = cached?.pendingThought ?? '';
		delivery = cached?.delivery ?? '';
	}

	async function loadActiveTab() {
		const request = {
			generation: ++tabRequestGeneration,
			projectId: selectedProject?.id ?? '',
			tab: activeTab
		};
		loading = true;
		error = '';
		try {
			if (request.tab === 'sessions') {
				const body = await api<{ sessions: Session[] }>(sessionApiPath());
				if (!isCurrentTabRequest(request, currentTabRequest())) return;
				sessions = body.sessions;
				sessionLists.set(request.projectId || 'none', body.sessions);
				if (selectedSession) {
					selectedSession =
						sessions.find((session) => session.sessionId === selectedSession?.sessionId) ??
						selectedSession;
				}
			} else if (selectedProject) {
				const body = await api<{ workflows: Workflow[] }>(
					`/api/projects/${request.projectId}/workflows`
				);
				if (!isCurrentTabRequest(request, currentTabRequest())) return;
				workflows = body.workflows;
				workflowLists.set(request.projectId, body.workflows);
			} else {
				workflows = [];
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

	function openEditProject(event: MouseEvent, project: Project) {
		event.stopPropagation();
		editingProject = project;
		projectName = project.name;
		projectIcon = project.icon;
		projectEmojiPickerOpen = false;
		projectEditError = '';
		editProjectDialog.showModal();
	}

	function isProjectImage(icon: string | null): boolean {
		return icon?.startsWith('data:image/') ?? false;
	}

	async function chooseProjectImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
			projectEditError = 'Only PNG, JPEG, GIF, and WebP images are supported';
			return;
		}
		if (file.size > 1024 * 1024) {
			projectEditError = 'Project icon image must be 1 MB or smaller';
			return;
		}
		projectIcon = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
		projectEditError = '';
	}

	async function saveProject(event: SubmitEvent) {
		event.preventDefault();
		if (!editingProject) return;
		projectSaving = true;
		projectEditError = '';
		try {
			const body = await api<{ project: Project }>(`/api/projects/${editingProject.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ name: projectName, icon: projectIcon })
			});
			projects = projects.map((project) =>
				project.id === body.project.id ? body.project : project
			);
			if (selectedProject?.id === body.project.id) selectedProject = body.project;
			editProjectDialog.close();
		} catch (cause) {
			projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			projectSaving = false;
		}
	}

	function requestRemoveProject() {
		if (editingProject) removeProjectDialog.showModal();
	}

	async function removeProject() {
		if (!editingProject) return;
		removeProjectDialog.close();
		projectSaving = true;
		projectEditError = '';
		try {
			const removedId = editingProject.id;
			await api(`/api/projects/${removedId}`, { method: 'DELETE' });
			projects = projects.filter((project) => project.id !== removedId);
			editProjectDialog.close();
			if (selectedProject?.id === removedId) {
				const nextProject = projects[0];
				if (nextProject) await chooseProject(nextProject);
				else {
					endVoiceCall(false);
					selectedProject = null;
					selectedSession = null;
					sessions = [];
					workflows = [];
					transcript = [];
					persistSelection();
				}
			}
		} catch (cause) {
			projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			projectSaving = false;
		}
	}

	function openEditSession(event: MouseEvent, session: Session) {
		event.stopPropagation();
		editingSession = session;
		sessionIcon = session.customIcon ?? null;
		sessionEmojiPickerOpen = false;
		sessionEditError = '';
		editSessionDialog.showModal();
	}

	function sessionIconPreview(): string {
		return sessionIcon ?? automaticSessionIcon(editingSession?.title);
	}

	async function chooseSessionImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
			sessionEditError = 'Only PNG, JPEG, GIF, and WebP images are supported';
			return;
		}
		if (file.size > 1024 * 1024) {
			sessionEditError = 'Session icon image must be 1 MB or smaller';
			return;
		}
		sessionIcon = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
		sessionEditError = '';
	}

	async function saveSessionIcon(event: SubmitEvent) {
		event.preventDefault();
		if (!editingSession) return;
		sessionSaving = true;
		sessionEditError = '';
		try {
			const body = await api<{ icon: string | null }>(sessionApiPath(editingSession.sessionId), {
				method: 'PATCH',
				body: JSON.stringify({ icon: sessionIcon })
			});
			const updated = {
				...editingSession,
				customIcon: body.icon,
				icon: body.icon ?? automaticSessionIcon(editingSession.title)
			};
			sessions = sessions.map((session) =>
				session.sessionId === updated.sessionId ? updated : session
			);
			if (selectedSession?.sessionId === updated.sessionId) selectedSession = updated;
			editSessionDialog.close();
		} catch (cause) {
			sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			sessionSaving = false;
		}
	}

	async function createSession(): Promise<Session | null> {
		endVoiceCall(false);
		saveCurrentDraft();
		cacheCurrentSessionView();
		const projectId = selectedProject?.id ?? null;
		const path = sessionApiPath();
		void closeProjectTerminals();
		loading = true;
		try {
			const body = await api<{
				session: Session;
				commands?: HermesCommand[];
				runtime?: HermesRuntime;
				branch?: string | null;
			}>(path, { method: 'POST' });
			if ((selectedProject?.id ?? null) !== projectId) return null;
			sessions = [body.session, ...sessions];
			sessionLists.set(projectId ?? 'none', sessions);
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
			pendingImages = [];
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
		if (selectedSession?.sessionId !== session.sessionId) endVoiceCall(false);
		void closeProjectTerminals();
		const request = {
			generation: ++sessionRequestGeneration,
			projectId: selectedProject?.id ?? '',
			sessionId: session.sessionId
		};
		saveCurrentDraft();
		cacheCurrentSessionView();
		stopPolling();
		selectedSession = session;
		showCachedSessionView(session);
		beginTranscriptEntryStick?.();
		await scrollToLatest();
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
			}>(sessionApiPath(session.sessionId));
			if (
				!selectedSession ||
				!isCurrentSessionRequest(request, {
					generation: sessionRequestGeneration,
					projectId: selectedProject?.id ?? '',
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
			pendingImages = body.activeTurn?.images ?? [];
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
			cacheCurrentSessionView();
			beginTranscriptEntryStick?.();
			await scrollToLatest();
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
		if (!selectedSession) return false;
		const messageId = crypto.randomUUID();
		try {
			await api<{ status: string }>(sessionApiPath(selectedSession.sessionId, '/messages'), {
				method: 'POST',
				body: JSON.stringify({ messageId, text, images })
			});
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
		if (!selectedSession || !editingQueuedMessageId) return false;
		try {
			const body = await api<{ message: QueuedMessage }>(
				sessionApiPath(selectedSession.sessionId, '/messages'),
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

	async function copyMessage(message: TranscriptMessage) {
		try {
			await navigator.clipboard.writeText(message.text);
			messageNotice = 'Message copied';
		} catch {
			messageNotice = 'Copy unavailable';
		}
	}

	async function editMessage(message: TranscriptMessage) {
		composer = message.text;
		images = [...(message.images ?? [])];
		saveCurrentDraft();
		await tick();
		composerElement?.focus();
	}

	async function forkSession() {
		if (!selectedSession || isTurnBusy(delivery)) return;
		const projectId = selectedProject?.id ?? null;
		const sessionId = selectedSession.sessionId;
		const path = sessionApiPath(sessionId);
		loading = true;
		error = '';
		try {
			const body = await api<{ session: Session }>(path, {
				method: 'POST'
			});
			if ((selectedProject?.id ?? null) !== projectId || selectedSession?.sessionId !== sessionId)
				return;
			sessions = [body.session, ...sessions];
			await openSession(body.session);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function stopTurn() {
		if (!selectedSession || stopping) return;
		stopping = true;
		try {
			await api(sessionApiPath(selectedSession.sessionId, '/cancel'), {
				method: 'POST'
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			stopping = false;
		}
	}

	async function sendText(text: string, attachments: ImageAttachment[] = images): Promise<boolean> {
		if (!selectedSession || isTurnBusy(delivery)) return false;
		if (callActive) {
			stopCallRecording(true);
			voiceResponseText = '';
			voiceSpokenOffset = 0;
			callStatus = 'thinking';
		}
		const session = selectedSession;
		const projectId = selectedProject?.id ?? null;
		const envelope =
			pendingEnvelope?.projectId === projectId &&
			pendingEnvelope.sessionId === selectedSession.sessionId &&
			pendingEnvelope.text === text
				? pendingEnvelope
				: {
						id: crypto.randomUUID(),
						projectId,
						sessionId: selectedSession.sessionId,
						text,
						images: attachments
					};
		const messageId = envelope.id;
		activeMessageId = messageId;
		pendingAssistant = '';
		pendingImages = [];
		pendingThought = '';
		delivery = 'saving';
		setSessionBusySince(session.sessionId, new Date().toISOString());
		try {
			const accepted = await api<{ duplicate: boolean; status: string }>(
				sessionApiPath(selectedSession.sessionId, '/messages'),
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
			await scrollToLatest();
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

	async function scrollToLatest(behavior: ScrollBehavior = 'auto') {
		await tick();
		writeLatest(behavior);
	}

	function writeLatest(behavior: ScrollBehavior = 'auto') {
		if (!transcriptElement) return;
		followingTranscript = true;
		showScrollToLatest = false;
		automaticScrollUntil = performance.now() + (behavior === 'smooth' ? 750 : 100);
		const top = transcriptElement.scrollHeight + 4096;
		if (behavior === 'smooth') transcriptElement.scrollTo({ top, behavior });
		else transcriptElement.scrollTop = top;
	}

	function followTranscript(node: HTMLElement) {
		let lastTop = node.scrollTop;
		let touchY: number | null = null;
		let entryStick = true;
		let entryHeight = node.scrollHeight;
		let quietTimer: ReturnType<typeof setTimeout>;
		let capTimer: ReturnType<typeof setTimeout>;
		const beginEntryStick = () => {
			entryStick = true;
			entryHeight = node.scrollHeight;
			clearTimeout(quietTimer);
			clearTimeout(capTimer);
			quietTimer = setTimeout(() => (entryStick = false), 600);
			capTimer = setTimeout(() => (entryStick = false), 8_000);
		};
		beginTranscriptEntryStick = beginEntryStick;
		beginEntryStick();

		const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;
		const bottomZone = () =>
			matchMedia('(max-width: 700px)').matches ? 40 : Math.max(48, node.clientHeight * 0.1);
		const canScroll = () => node.scrollHeight - node.clientHeight > 1;
		const updateButton = () => {
			showScrollToLatest =
				canScroll() && !followingTranscript && distanceFromBottom() > bottomZone();
		};
		const release = () => {
			entryStick = false;
			followingTranscript = !canScroll();
			updateButton();
		};
		const handleScroll = () => {
			const scrollingDown = node.scrollTop > lastTop + 0.5;
			lastTop = node.scrollTop;
			if (!canScroll()) {
				followingTranscript = true;
				updateButton();
				return;
			}
			const distance = distanceFromBottom();
			if (distance <= bottomZone()) {
				if (scrollingDown || followingTranscript || distance <= 2) followingTranscript = true;
				updateButton();
				return;
			}
			if (followingTranscript && performance.now() < automaticScrollUntil) return;
			release();
		};
		const handleWheel = (event: WheelEvent) => event.deltaY < 0 && release();
		const handleTouchStart = (event: TouchEvent) => {
			touchY = event.touches.item(0)?.clientY ?? null;
		};
		const handleTouchMove = (event: TouchEvent) => {
			const nextY = event.touches.item(0)?.clientY ?? null;
			if (nextY !== null && touchY !== null && nextY - touchY > 2) release();
			touchY = nextY;
		};
		const handleKeydown = (event: KeyboardEvent) => {
			if (
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				['ArrowUp', 'PageUp', 'Home'].includes(event.key)
			) {
				release();
			}
		};
		const observer = new ResizeObserver(() => {
			updateButton();
			if (entryStick) {
				const grew = node.scrollHeight > entryHeight + 1;
				entryHeight = node.scrollHeight;
				writeLatest();
				if (grew) {
					clearTimeout(quietTimer);
					quietTimer = setTimeout(() => (entryStick = false), 600);
				}
				return;
			}
			if (followingTranscript && (isTurnBusy(delivery) || Date.now() < transcriptSettleUntil)) {
				writeLatest();
			}
		});

		node.addEventListener('scroll', handleScroll, { passive: true });
		node.addEventListener('wheel', handleWheel, { passive: true });
		node.addEventListener('touchstart', handleTouchStart, { passive: true });
		node.addEventListener('touchmove', handleTouchMove, { passive: true });
		node.addEventListener('keydown', handleKeydown);
		observer.observe(node);
		if (node.firstElementChild) observer.observe(node.firstElementChild);

		return {
			destroy() {
				if (beginTranscriptEntryStick === beginEntryStick) beginTranscriptEntryStick = null;
				clearTimeout(quietTimer);
				clearTimeout(capTimer);
				observer.disconnect();
				node.removeEventListener('scroll', handleScroll);
				node.removeEventListener('wheel', handleWheel);
				node.removeEventListener('touchstart', handleTouchStart);
				node.removeEventListener('touchmove', handleTouchMove);
				node.removeEventListener('keydown', handleKeydown);
			}
		};
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
		return selectedSession
			? `hue:draft:${selectedProject?.id ?? 'none'}:${selectedSession.sessionId}`
			: '';
	}

	function pendingEnvelopeKey() {
		return selectedSession
			? `hue:pending:${selectedProject?.id ?? 'none'}:${selectedSession.sessionId}`
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

	function stopCallPlayback() {
		callSpeechAbort?.abort();
		callSpeechAbort = null;
		void callSpeechContext?.close().catch(() => undefined);
		callSpeechContext = null;
		if (callAudio) {
			callAudio.pause();
			callAudio.src = '';
			callAudio = null;
		}
	}

	function stopCallMonitor() {
		if (callMonitor) clearInterval(callMonitor);
		callMonitor = null;
		void callMonitorContext?.close().catch(() => undefined);
		callMonitorContext = null;
	}

	function stopCallRecording(discard = true) {
		stopCallMonitor();
		if (callRecorder?.state === 'recording') {
			if (discard) discardedRecorders.add(callRecorder);
			callRecorder.stop();
		}
	}

	function isCallRecording() {
		return callRecorder?.state === 'recording';
	}

	async function blobDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	async function transcribeCallAudio(blob: Blob, generation: number) {
		if (!callActive || callMuted || generation !== callGeneration) return;
		callStatus = 'transcribing';
		const abort = new AbortController();
		callTranscribeAbort = abort;
		try {
			const dataUrl = await blobDataUrl(blob);
			if (!callActive || callMuted || generation !== callGeneration || abort.signal.aborted) return;
			const response = await fetch('/api/voice/transcribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					dataUrl,
					mimeType: blob.type || 'audio/webm'
				}),
				signal: abort.signal
			});
			const result = (await response.json()) as { text?: string; error?: string };
			if (!response.ok)
				throw new Error(result.error ?? `Transcription failed (${response.status})`);
			if (!callActive || generation !== callGeneration) return;
			const text = (result.text ?? '').trim();
			if (!text) return void beginCallListening();
			if (/^(?:stop|end call|goodbye)$/i.test(text.replace(/[.!?]+$/, ''))) {
				endVoiceCall();
				return;
			}
			if (voiceMessageOnly) {
				endVoiceCall(false);
				await sendText(text);
				await tick();
				composerElement?.focus();
				return;
			}
			voiceResponseText = '';
			voiceSpokenOffset = 0;
			callStatus = 'thinking';
			if (!(await sendText(text))) void beginCallListening();
		} catch (cause) {
			if (!abort.signal.aborted) callError = cause instanceof Error ? cause.message : String(cause);
			if (callActive && generation === callGeneration) void beginCallListening();
		} finally {
			if (callTranscribeAbort === abort) callTranscribeAbort = null;
		}
	}

	async function beginCallListening() {
		if (!callActive || callMuted || isTurnBusy(delivery) || isCallRecording()) return;
		const generation = callGeneration;
		let acquisition: Promise<MediaStream> | null = null;
		try {
			let stream = callStream;
			if (!stream) {
				acquisition =
					callStreamPromise ??
					(callStreamPromise = navigator.mediaDevices.getUserMedia({
						audio: { echoCancellation: true, noiseSuppression: true }
					}));
				stream = await acquisition;
				if (callStreamPromise === acquisition) callStreamPromise = null;
				if (!callActive || callMuted || generation !== callGeneration) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				callStream = stream;
			}
			if (isCallRecording()) return;
			stream.getAudioTracks().forEach((track) => (track.enabled = true));
			const recorder = new MediaRecorder(stream);
			const chunks: Blob[] = [];
			callRecorder = recorder;
			recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
			recorder.onstop = () => {
				if (callRecorder === recorder) callRecorder = null;
				const discard = discardedRecorders.has(recorder);
				if (!discard && chunks.length) {
					void transcribeCallAudio(new Blob(chunks, { type: recorder.mimeType }), generation);
				} else if (callActive && !callMuted && generation === callGeneration) {
					void beginCallListening();
				}
			};
			recorder.start();
			callError = '';
			callStatus = 'listening';

			const context = new AudioContext();
			const source = context.createMediaStreamSource(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			callMonitorContext = context;
			const samples = new Uint8Array(analyser.fftSize);
			const startedAt = Date.now();
			let heardSpeech = false;
			let silentSince = 0;
			callMonitor = setInterval(() => {
				analyser.getByteTimeDomainData(samples);
				const rms = Math.sqrt(
					samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
				);
				if (rms > 0.04) {
					heardSpeech = true;
					silentSince = 0;
				} else if (heardSpeech) {
					silentSince ||= Date.now();
					if (Date.now() - silentSince >= 1_250) stopCallRecording(false);
				} else if (Date.now() - startedAt >= 12_000) {
					stopCallRecording(true);
				}
			}, 100);
		} catch (cause) {
			if (callStreamPromise === acquisition) callStreamPromise = null;
			if (!callActive || generation !== callGeneration) return;
			callError = cause instanceof Error ? cause.message : String(cause);
			error = callError;
			endVoiceCall();
		}
	}

	async function playCallSpeech(text: string, generation: number) {
		if (!text.trim() || !callActive || generation !== callGeneration) return;
		callError = '';
		callStatus = 'speaking';
		const abort = new AbortController();
		callSpeechAbort = abort;
		try {
			const response = await fetch('/api/voice/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
				signal: abort.signal
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error ?? `Speech failed (${response.status})`);
			}
			if (response.headers.get('content-type')?.startsWith('audio/L16')) {
				await playPcmResponse(response, abort.signal);
			} else {
				await playAudioResponse(response, abort.signal);
			}
		} catch (cause) {
			if (!abort.signal.aborted) callError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (callSpeechAbort === abort) callSpeechAbort = null;
		}
	}

	async function playAudioResponse(response: Response, signal: AbortSignal) {
		const url = URL.createObjectURL(await response.blob());
		const audio = new Audio(url);
		callAudio = audio;
		try {
			await new Promise<void>((resolve, reject) => {
				const stop = () => {
					audio.pause();
					resolve();
				};
				signal.addEventListener('abort', stop, { once: true });
				audio.onended = () => resolve();
				audio.onerror = () => reject(new Error('Speech playback failed'));
				void audio.play().catch(reject);
			});
		} finally {
			URL.revokeObjectURL(url);
			if (callAudio === audio) callAudio = null;
		}
	}

	async function playPcmResponse(response: Response, signal: AbortSignal) {
		if (!response.body) throw new Error('Hermes returned no speech audio');
		const sampleRate = Number(response.headers.get('x-audio-sample-rate')) || 24_000;
		const context = new AudioContext();
		callSpeechContext = context;
		try {
			const reader = response.body.getReader();
			let nextStart = context.currentTime;
			let carry: Uint8Array | null = null;
			while (!signal.aborted) {
				const { done, value } = await reader.read();
				if (done) break;
				let bytes = value;
				if (carry) {
					const joined = new Uint8Array(carry.length + bytes.length);
					joined.set(carry);
					joined.set(bytes, carry.length);
					bytes = joined;
					carry = null;
				}
				const usable = bytes.length - (bytes.length % 2);
				if (usable !== bytes.length) carry = bytes.slice(usable);
				if (!usable) continue;
				const pcm = new Int16Array(bytes.slice(0, usable).buffer);
				const buffer = context.createBuffer(1, pcm.length, sampleRate);
				const channel = buffer.getChannelData(0);
				for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32_768;
				const source = context.createBufferSource();
				source.buffer = buffer;
				source.connect(context.destination);
				const start = Math.max(context.currentTime + 0.03, nextStart);
				source.start(start);
				nextStart = start + buffer.duration;
			}
			if (!signal.aborted) {
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(0, nextStart - context.currentTime) * 1_000)
				);
			}
		} finally {
			await context.close().catch(() => undefined);
			if (callSpeechContext === context) callSpeechContext = null;
		}
	}

	function queueCallSpeech(complete: boolean) {
		if (!callActive) return;
		const next = takeSpeakableText(voiceResponseText, voiceSpokenOffset, complete);
		if (!next.text) return;
		voiceSpokenOffset = next.offset;
		const generation = callGeneration;
		voiceSpeechQueue = voiceSpeechQueue.then(() => playCallSpeech(next.text, generation));
	}

	function applyVoiceEvents(events: SessionEvent[]) {
		if (!callActive) return;
		let finished = false;
		for (const event of events) {
			if (event.payload.messageId !== activeMessageId) continue;
			if (event.type === 'agent.chunk') {
				voiceResponseText += String(event.payload.text ?? '');
				queueCallSpeech(false);
			}
			if (['message.completed', 'message.failed', 'message.unknown'].includes(event.type)) {
				queueCallSpeech(true);
				finished = true;
			}
		}
		if (finished) {
			const generation = callGeneration;
			void voiceSpeechQueue.finally(() => {
				if (callActive && !callMuted && generation === callGeneration) void beginCallListening();
			});
		}
	}

	async function startVoiceCapture(messageOnly: boolean) {
		if (callActive || !selectedSession) return;
		callGeneration += 1;
		callActive = true;
		voiceMessageOnly = messageOnly;
		callMuted = false;
		callError = '';
		voiceResponseText = '';
		voiceSpokenOffset = 0;
		voiceSpeechQueue = Promise.resolve();
		await tick();
		if (messageOnly) voiceCancelElement?.focus();
		else callMuteElement?.focus();
		await beginCallListening();
	}

	const startVoiceCall = () => startVoiceCapture(false);
	const startVoiceMessage = () => startVoiceCapture(true);

	function toggleCallMute() {
		if (!callActive) return;
		callMuted = !callMuted;
		callStream?.getAudioTracks().forEach((track) => (track.enabled = !callMuted));
		if (callMuted) {
			callTranscribeAbort?.abort();
			stopCallRecording(true);
		} else if (!isTurnBusy(delivery)) {
			void beginCallListening();
		}
	}

	async function interruptVoiceCall() {
		if (!callActive) return;
		callGeneration += 1;
		voiceResponseText = '';
		voiceSpokenOffset = 0;
		voiceSpeechQueue = Promise.resolve();
		callTranscribeAbort?.abort();
		stopCallPlayback();
		if (isTurnBusy(delivery)) await stopTurn();
		if (callActive && !callMuted) void beginCallListening();
		await tick();
		callMuteElement?.focus();
	}

	function endVoiceCall(restoreFocus = true) {
		const messageOnly = voiceMessageOnly;
		callGeneration += 1;
		callActive = false;
		voiceMessageOnly = false;
		callMuted = false;
		callStatus = 'idle';
		stopCallRecording(true);
		callTranscribeAbort?.abort();
		callTranscribeAbort = null;
		stopCallPlayback();
		callStream?.getTracks().forEach((track) => track.stop());
		callStream = null;
		callStreamPromise = null;
		if (restoreFocus) {
			void tick().then(() => (messageOnly ? voiceMessageElement : voiceStartElement)?.focus());
		}
	}

	function contextPercent() {
		if (!runtime.usage?.size) return null;
		return Math.max(0, Math.min(100, Math.round((runtime.usage.used / runtime.usage.size) * 100)));
	}

	function modelCategories() {
		const labels: Record<string, string> = {
			anthropic: 'Anthropic',
			google: 'Google',
			openai: 'OpenAI',
			openrouter: 'OpenRouter'
		};
		const categories = new Map<string, NonNullable<HermesRuntime['models']>['availableModels']>();
		for (const model of runtime.models?.availableModels ?? []) {
			const provider = model.modelId.includes(':') ? model.modelId.split(':', 1)[0] : 'other';
			const label =
				labels[provider] ?? provider.replace(/(^|[-_])\w/g, (part) => part.toUpperCase());
			categories.set(label, [...(categories.get(label) ?? []), model]);
		}
		return [...categories].map(([name, models]) => ({ name, models }));
	}

	function currentModel() {
		return runtime.models?.availableModels.find(
			(model) => model.modelId === runtime.models?.currentModelId
		);
	}

	async function changeRuntime(kind: 'modelId' | 'modeId', value: string) {
		if (!selectedSession) return;
		runtimeChanging = true;
		try {
			const body = await api<{ runtime: HermesRuntime }>(
				sessionApiPath(selectedSession.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ [kind]: value }) }
			);
			runtime = { ...runtime, ...body.runtime };
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			runtimeChanging = false;
		}
	}

	function selectModel(modelId: string) {
		modelPopover?.hidePopover();
		void changeRuntime('modelId', modelId);
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
		if (!selectedSession) return;
		const projectId = selectedProject?.id ?? null;
		const sessionId = selectedSession.sessionId;
		const eventsPath = sessionApiPath(sessionId, `/events?after=${eventCursor}`);
		await runSingleFlight(pollFlight, async () => {
			try {
				const body = await api<{ events: SessionEvent[]; runtime?: HermesRuntime }>(eventsPath);
				if ((selectedProject?.id ?? null) !== projectId || selectedSession?.sessionId !== sessionId)
					return;
				applyVoiceEvents(body.events);
				const next = applySessionEvents(
					{
						cursor: eventCursor,
						activeMessageId,
						pendingAssistant,
						pendingImages,
						pendingThought,
						delivery,
						transcript,
						subagents
					},
					body.events
				);
				const wasBusy = isTurnBusy(delivery);
				eventCursor = next.cursor;
				pendingAssistant = next.pendingAssistant;
				pendingImages = next.pendingImages ?? [];
				pendingThought = next.pendingThought ?? '';
				delivery = next.delivery;
				if (wasBusy && !isTurnBusy(delivery)) transcriptSettleUntil = Date.now() + 300;
				transcript = next.transcript;
				subagents = next.subagents ?? [];
				if (body.runtime) runtime = { ...runtime, ...body.runtime };
				if (!isTurnBusy(delivery)) {
					setSessionBusySince(sessionId, null);
					await loadActiveTab();
					if (queuedMessages.length && selectedSession) await openSession(selectedSession);
					else stopPolling();
				}
			} catch {
				if (
					(selectedProject?.id ?? null) === projectId &&
					selectedSession?.sessionId === sessionId
				) {
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
		endVoiceCall(false);
		stopPolling();
		void closeProjectTerminals();
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
		<button
			class="global-action"
			class:active={globalView === null}
			aria-label="Workspace"
			aria-current={globalView === null ? 'page' : undefined}
			title="Workspace"
			onclick={() => (globalView = null)}
		>
			<MessageSquare aria-hidden="true" />
		</button>
		<div class="global-admin">
			<button
				class="global-action"
				class:active={globalView === 'settings'}
				aria-label="Settings"
				title="Settings"
				onclick={() => openHermesPanel('settings')}
			>
				<Settings aria-hidden="true" />
			</button>
			<button
				class="global-action runtime-inspector-button"
				class:active={globalView === 'runtime'}
				aria-label="Inspect Hermes runtime"
				title="Hermes runtime"
				onclick={() => openHermesPanel('runtime')}
			>
				<SlidersHorizontal aria-hidden="true" />
			</button>
			<button
				class="global-action"
				class:active={globalView === 'schedules'}
				aria-label="Schedules"
				title="Schedules"
				onclick={() => openHermesPanel('schedules')}
			>
				<CalendarDays aria-hidden="true" />
			</button>
			<button
				class="global-action"
				class:active={globalView === 'skills'}
				aria-label="Skills"
				title="Skills"
				onclick={() => openHermesPanel('skills')}
			>
				<Grid2X2 aria-hidden="true" />
			</button>
			<button
				class="global-action"
				class:active={globalView === 'commands'}
				aria-label="Commands"
				title="Session commands"
				onclick={() => openHermesPanel('commands')}
			>
				<Code2 aria-hidden="true" />
			</button>
			<button
				class="global-action"
				class:active={globalView === 'profiles'}
				aria-label="Profiles"
				title="Profiles"
				onclick={() => openHermesPanel('profiles')}
			>
				<UserRound aria-hidden="true" />
			</button>
			<button
				class="global-action"
				class:active={globalView === 'mcp'}
				aria-label="MCP"
				title="MCP servers"
				onclick={() => openHermesPanel('mcp')}
			>
				<Plug aria-hidden="true" />
			</button>
		</div>
		<a
			class="global-action global-docs"
			href="/docs/"
			target="_blank"
			aria-label="Open documentation in a new tab"
			title="Documentation"
		>
			<FileText aria-hidden="true" />
		</a>
	</nav>
	<nav class="mobile-navigation" aria-label="Workspace navigation">
		<button
			aria-controls="project-drawer"
			aria-expanded={mobileDrawer === 'projects'}
			title="Projects"
			onclick={() => (mobileDrawer = mobileDrawer === 'projects' ? null : 'projects')}
			>Projects</button
		>
		<button
			aria-controls="session-drawer"
			aria-expanded={mobileDrawer === 'sessions'}
			title="Sessions"
			onclick={() => (mobileDrawer = mobileDrawer === 'sessions' ? null : 'sessions')}
			>Sessions</button
		>
		<button aria-label="Settings" title="Settings" onclick={() => openHermesPanel('settings')}
			>Settings</button
		>
	</nav>
	{#if globalView}<section
			class="global-panel"
			aria-label={globalView === 'settings' ? 'Settings' : 'Hermes management'}
		>
			<header>
				<div>
					<small>{globalView === 'settings' ? 'HUE' : 'Hermes'}</small>
					<h1>
						{globalView === 'settings'
							? 'Settings'
							: globalView === 'runtime'
								? 'Runtime'
								: globalView === 'skills'
									? 'Installed skills'
									: globalView === 'schedules'
										? 'Scheduled jobs'
										: globalView === 'commands'
											? 'Session commands'
											: globalView === 'profiles'
												? 'Profiles'
												: 'MCP servers'}
					</h1>
				</div>
				<button
					aria-label="Back to workspace"
					title="Back to workspace"
					onclick={() => (globalView = null)}><ArrowLeft size={18} aria-hidden="true" /></button
				>
			</header>
			<nav class="global-panel-tabs" aria-label="Hermes sections">
				<button
					title="Settings overview"
					class:active={globalView === 'settings'}
					onclick={() => openHermesPanel('settings')}>Overview</button
				>
				<button
					title="Runtime"
					class:active={globalView === 'runtime'}
					onclick={() => openHermesPanel('runtime')}>Runtime</button
				>
				<button
					title="Skills"
					class:active={globalView === 'skills'}
					onclick={() => openHermesPanel('skills')}>Skills</button
				>
				<button
					title="Schedules"
					class:active={globalView === 'schedules'}
					onclick={() => openHermesPanel('schedules')}>Schedules</button
				>
				<button
					title="Commands"
					class:active={globalView === 'commands'}
					onclick={() => openHermesPanel('commands')}>Commands</button
				>
				<button
					title="Profiles"
					class:active={globalView === 'profiles'}
					onclick={() => openHermesPanel('profiles')}>Profiles</button
				>
				<button
					title="MCP servers"
					class:active={globalView === 'mcp'}
					onclick={() => openHermesPanel('mcp')}>MCP</button
				>
			</nav>
			<div class="global-panel-content">
				{#if hermesLoading && globalView !== 'commands'}<p class="muted" role="status">
						Loading Hermes {globalView}…
					</p>
				{:else if hermesError}<p class="directory-error" role="alert">{hermesError}</p>
				{:else if globalView === 'settings'}<div class="settings-overview">
						<div class="settings-intro">
							<h2>Manage Hermes from one place</h2>
							<p>Inspect the runtime, maintain agent resources, and review integrations.</p>
						</div>
						<div class="settings-grid">
							<button title="Open Runtime settings" onclick={() => openHermesPanel('runtime')}>
								<div>
									<strong>Runtime</strong><span
										>Check the connection and advertised capabilities.</span
									>
								</div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
							<button title="Open Skills settings" onclick={() => openHermesPanel('skills')}>
								<div>
									<strong>Skills</strong><span>Find and maintain installed agent skills.</span>
								</div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
							<button title="Open Schedules settings" onclick={() => openHermesPanel('schedules')}>
								<div>
									<strong>Schedules</strong><span>Review automated jobs and their run state.</span>
								</div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
							<button title="Open Commands settings" onclick={() => openHermesPanel('commands')}>
								<div>
									<strong>Commands</strong><span>See commands available in active sessions.</span>
								</div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
							<button title="Open Profiles settings" onclick={() => openHermesPanel('profiles')}>
								<div>
									<strong>Profiles</strong><span>Compare configured models and gateways.</span>
								</div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
							<button title="Open MCP settings" onclick={() => openHermesPanel('mcp')}>
								<div><strong>MCP</strong><span>Review connected tool servers.</span></div>
								<ChevronRight size={18} aria-hidden="true" />
							</button>
						</div>
					</div>
				{:else if globalView === 'runtime' && hermesInfo}<div class="inventory-grid">
						<article><small>Profile</small><strong>{hermesInfo.profile}</strong></article>
						<article>
							<small>Agent</small><strong
								>{hermesInfo.agent
									? `${hermesInfo.agent.name} ${hermesInfo.agent.version}`
									: 'Hermes ACP'}</strong
							>
						</article>
						<article>
							<small>Protocol</small><strong>ACP v{hermesInfo.protocolVersion ?? 1}</strong>
						</article>
						{#if hermesInfo.capabilities}<details>
								<summary>Advertised capabilities</summary>
								<pre>{JSON.stringify(hermesInfo.capabilities, null, 2)}</pre>
							</details>{/if}
					</div>
				{:else if globalView === 'skills'}
					{#if selectedSkill}<div class="skill-editor">
							<div class="skill-editor-heading">
								<button
									title="Back to skills"
									onclick={() => {
										selectedSkill = '';
										skillSaved = false;
									}}><ArrowLeft size={15} aria-hidden="true" /> Back to skills</button
								>
								<h2>{selectedSkill}</h2>
							</div>
							<div class="skill-editor-code">
								<pre bind:this={skillHighlightElement} aria-hidden="true"><code
										>{@html highlightMarkdown(skillContent)}</code
									></pre>
								<textarea
									bind:value={skillContent}
									aria-label="Skill content"
									spellcheck="false"
									onscroll={syncSkillEditorScroll}></textarea>
							</div>
							<div class="skill-editor-actions">
								{#if skillSaved}<span role="status">Saved</span>{/if}
								<button title="Save skill" onclick={saveSkill} disabled={skillSaving}
									>{skillSaving ? 'Saving…' : 'Save skill'}</button
								>
							</div>
						</div>
					{:else}<section class="skill-statistics" aria-label="Skill statistics">
							<article aria-label={`${hermesSkills.length} installed skills`}>
								<strong>{hermesSkills.length}</strong><span>Installed</span>
							</article>
							<article
								aria-label={`${hermesSkills.filter((skill) => skill.status === 'enabled').length} enabled skills`}
							>
								<strong>{hermesSkills.filter((skill) => skill.status === 'enabled').length}</strong
								><span>Enabled</span>
							</article>
							<article aria-label={`${skillOptions('category').length} skill categories`}>
								<strong>{skillOptions('category').length}</strong><span>Categories</span>
							</article>
							<article aria-label={`${skillOptions('source').length} skill sources`}>
								<strong>{skillOptions('source').length}</strong><span>Sources</span>
							</article>
						</section>
						<div class="skill-controls">
							<input
								bind:value={hermesFilter}
								class="inventory-filter"
								placeholder="Filter installed skills"
								aria-label="Filter installed skills"
							/>
							<select bind:value={hermesCategory} aria-label="Filter skills by category">
								<option value="all">All categories</option>
								{#each skillOptions('category') as category}<option value={category}
										>{inventoryLabel(category)}</option
									>{/each}
							</select>
							<select bind:value={hermesSource} aria-label="Filter skills by source">
								<option value="all">All sources</option>
								{#each skillOptions('source') as source}<option value={source}
										>{inventoryLabel(source)}</option
									>{/each}
							</select>
							<select bind:value={hermesStatus} aria-label="Filter skills by status">
								<option value="all">All statuses</option>
								{#each skillOptions('status') as status}<option value={status}
										>{inventoryLabel(status)}</option
									>{/each}
							</select>
							<select bind:value={hermesGroup} aria-label="Group skills">
								<option value="none">No grouping</option>
								<option value="category">Group by category</option>
								<option value="source">Group by source</option>
							</select>
						</div>
						<p class="skill-result-count">
							{filteredSkills().length} of {hermesSkills.length} skills
						</p>
						<div class="skill-groups">
							{#each skillGroups() as group}
								<section class="skill-group">
									{#if group.name}<h2>{group.name}</h2>{/if}
									<div class="inventory-list">
										{#each group.skills as skill}
											<button
												class="inventory-row"
												aria-label={skill.name}
												title={`Open ${skill.name}`}
												onclick={() => openSkill(skill.name)}
											>
												<div>
													<strong>{skill.name}</strong><small
														>{skillCategory(skill)} · {skill.source}</small
													>
												</div>
												<span class:paused={skill.status !== 'enabled'}>{skill.status}</span>
											</button>
										{/each}
									</div>
								</section>
							{/each}
							{#if !filteredSkills().length}<p class="muted">No skills match these filters.</p>{/if}
						</div>{/if}
				{:else if globalView === 'schedules'}<section
						class="skill-statistics schedule-statistics"
						aria-label="Schedule statistics"
					>
						<article aria-label={`${hermesJobs.length} scheduled jobs`}>
							<strong>{hermesJobs.length}</strong><span>Jobs</span>
						</article>
						<article
							aria-label={`${hermesJobs.filter((job) => job.status === 'active').length} active jobs`}
						>
							<strong>{hermesJobs.filter((job) => job.status === 'active').length}</strong><span
								>Active</span
							>
						</article>
						<article
							aria-label={`${hermesJobs.filter((job) => job.status !== 'active').length} inactive jobs`}
						>
							<strong>{hermesJobs.filter((job) => job.status !== 'active').length}</strong><span
								>Inactive</span
							>
						</article>
					</section>
					<div class="skill-controls schedule-controls">
						<input
							bind:value={hermesFilter}
							class="inventory-filter"
							placeholder="Filter scheduled jobs"
							aria-label="Filter scheduled jobs"
						/>
						<select bind:value={hermesStatus} aria-label="Filter schedules by status">
							<option value="all">All statuses</option>
							{#each jobStatuses() as status}<option value={status}>{inventoryLabel(status)}</option
								>{/each}
						</select>
						<select bind:value={scheduleGroup} aria-label="Group schedules">
							<option value="none">No grouping</option>
							<option value="status">Group by status</option>
						</select>
					</div>
					<p class="skill-result-count">{filteredJobs().length} of {hermesJobs.length} jobs</p>
					<div class="skill-groups">
						{#each jobGroups() as group}
							<section class="skill-group">
								{#if group.name}<h2>{group.name}</h2>{/if}
								<div class="inventory-list">
									{#each group.jobs as job}<article>
											<div>
												<strong>{job.name || job.id}</strong>
												<small>{job.schedule || 'No schedule'}</small>
												{#if job.nextRun || job.lastRun}<small class="schedule-runs"
														>{job.nextRun ? `Next ${job.nextRun}` : ''}{job.nextRun && job.lastRun
															? ' · '
															: ''}{job.lastRun ? `Last ${job.lastRun}` : ''}</small
													>{/if}
											</div>
											<span class:paused={job.status !== 'active'}>{job.status}</span>
										</article>{/each}
								</div>
							</section>
						{/each}
						{#if !filteredJobs().length}<p class="muted">No jobs match these filters.</p>{/if}
					</div>
				{:else if globalView === 'profiles'}<div class="inventory-grid">
						{#each hermesProfiles as profile}<article>
								<small>{profile.active ? 'Active profile' : 'Profile'}</small><strong
									>{profile.name}</strong
								>
								<p>{profile.model} · Gateway {profile.gateway}</p>
							</article>{/each}
					</div>
				{:else if globalView === 'mcp'}<div class="inventory-list">
						{#each hermesMcpServers as server}<article>
								<div>
									<strong>{server.name}</strong><small
										>{server.command || server.url || server.transport}</small
									>
								</div>
								<span class:paused={!server.enabled}>{server.enabled ? 'enabled' : 'disabled'}</span
								>
							</article>{/each}
						{#if !hermesMcpServers.length}<p class="muted">No MCP servers configured.</p>{/if}
					</div>
				{:else if globalView === 'commands'}
					{#if commands.length}<div class="inventory-list">
							{#each commands as command}<article>
									<div><strong>/{command.name}</strong><small>{command.description}</small></div>
								</article>{/each}
						</div>
					{:else}<p class="muted">Open a Hermes Session to load its advertised commands.</p>{/if}
				{/if}
			</div>
		</section>{/if}
	{#if mobileDrawer}<button
			class="drawer-backdrop"
			aria-label="Close navigation"
			title="Close navigation"
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
			<button
				class="icon-button workspace-session-add"
				aria-label="New session without a project"
				title="New session without a project"
				onclick={createProjectlessSession}><Plus size={18} aria-hidden="true" /></button
			>
		</header>
		<div class="section-heading">
			<span class="section-label">Projects</span>
			<button
				class="icon-button"
				aria-label="Add project"
				title="Add project"
				onclick={openAddProject}><Plus size={18} aria-hidden="true" /></button
			>
		</div>
		<nav>
			<div class="project-row">
				<button
					class="project-select"
					class:active={!selectedProject}
					title="Open sessions with no project"
					onclick={() => chooseProject(null)}
				>
					<Diamond class="project-icon" size={18} aria-hidden="true" /><span>No project</span>
				</button>
			</div>
			{#each projects as project}
				<div class="project-row">
					<button
						class="project-select"
						class:active={selectedProject?.id === project.id}
						title={`Open ${project.name}`}
						onclick={() => chooseProject(project)}
					>
						{#if isProjectImage(project.icon)}<img
								class="project-icon project-icon-image"
								src={project.icon ?? ''}
								alt=""
							/>
						{:else if project.icon}<span class="project-icon">{project.icon}</span>
						{:else}<span class="project-dot"></span>{/if}<span>{project.name}</span>
					</button>
					<button
						class="project-edit"
						aria-label={`Edit ${project.name}`}
						title={`Edit ${project.name}`}
						onclick={(event) => openEditProject(event, project)}
						><Ellipsis size={16} aria-hidden="true" /></button
					>
				</div>
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
					aria-label="Parent directory"
					title="Parent directory"><ArrowUp size={16} aria-hidden="true" /></button
				>
				<code>{projectRoot || 'Loading…'}</code>
			</div>
			<section class="directory-browser" aria-label="Directories">
				<strong>Directories</strong>
				{#if directoryLoading}<p class="muted">Loading directories…</p>
				{:else if directoryError}<p class="directory-error" role="alert">{directoryError}</p>
				{:else if projectDirectories.length === 0}<p class="muted">No subdirectories.</p>
				{:else}{#each projectDirectories as directory}
						<button
							class="directory-row"
							title={`Open ${directory.name}`}
							onclick={() => loadDirectory(directory.path)}
						>
							<Folder size={16} aria-hidden="true" /><span>{directory.name}</span><small
								>{#if projects.some((project) => project.rootPath === directory.path)}Added{:else}<Plus
										size={13}
										aria-label="Available to add"
									/>{/if}</small
							>
						</button>
					{/each}{/if}
			</section>
			<form class="add-project" onsubmit={addProject}>
				<button
					type="submit"
					title="Add this directory"
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
				title="Close add project"
				onclick={() => addProjectDialog.close()}><X size={18} aria-hidden="true" /></button
			>
		</dialog>
		<dialog
			bind:this={editProjectDialog}
			class="add-project-dialog edit-project-dialog"
			aria-labelledby="edit-project-title"
			onclick={(event) => event.target === event.currentTarget && editProjectDialog.close()}
		>
			<header>
				<div>
					<h2 id="edit-project-title">Edit project</h2>
					<p>Make this project easy to spot, rename it, or remove it from HUE.</p>
				</div>
			</header>
			<form onsubmit={saveProject}>
				<fieldset class="project-icon-field">
					<legend>Project icon</legend>
					<div class="project-icon-editor">
						<div class="project-icon-preview">
							{#if isProjectImage(projectIcon)}<img
									src={projectIcon ?? ''}
									alt="Project icon preview"
								/>
							{:else}<span>{projectIcon || '•'}</span>{/if}
						</div>
						<div class="project-icon-options">
							<div class="project-icon-upload">
								<button
									type="button"
									aria-label="Choose project emoji"
									title="Choose project emoji"
									onclick={() => (projectEmojiPickerOpen = !projectEmojiPickerOpen)}
									>Choose emoji</button
								>
								<label title="Choose a custom image">
									<span>Choose image</span>
									<input
										type="file"
										accept="image/png,image/jpeg,image/gif,image/webp"
										aria-label="Project icon image"
										onchange={chooseProjectImage}
									/>
								</label>
								<button
									type="button"
									title="Use default project dot"
									onclick={() => (projectIcon = null)}>Default</button
								>
							</div>
						</div>
					</div>
					{#if projectEmojiPickerOpen}<EmojiPicker
							onselect={(emoji) => {
								projectIcon = emoji;
								projectEmojiPickerOpen = false;
							}}
						/>{/if}
				</fieldset>
				<label>
					<span>Project name</span>
					<input bind:value={projectName} aria-label="Project name" required />
				</label>
				<label>
					<span>Project directory</span>
					<input value={editingProject?.rootPath ?? ''} aria-label="Project directory" disabled />
				</label>
				{#if projectEditError}<p class="directory-error" role="alert">{projectEditError}</p>{/if}
				<div class="edit-project-actions">
					<button
						type="button"
						class="danger-button"
						title="Remove project"
						disabled={projectSaving}
						onclick={requestRemoveProject}>Remove project</button
					>
					<button type="submit" title="Save changes" disabled={projectSaving || !projectName.trim()}
						>Save changes</button
					>
				</div>
			</form>
			<button
				class="icon-button"
				aria-label="Close edit project"
				title="Close edit project"
				onclick={() => editProjectDialog.close()}><X size={18} aria-hidden="true" /></button
			>
		</dialog>
		<dialog
			bind:this={removeProjectDialog}
			class="add-project-dialog confirmation-dialog"
			aria-labelledby="remove-project-title"
			aria-describedby="remove-project-description"
			onclick={(event) => event.target === event.currentTarget && removeProjectDialog.close()}
		>
			<header>
				<div>
					<h2 id="remove-project-title">Remove project?</h2>
					<p id="remove-project-description">
						Remove {editingProject?.name} from HUE? Hermes transcripts will not be deleted.
					</p>
				</div>
			</header>
			<div class="confirmation-actions">
				<button type="button" title="Keep project" onclick={() => removeProjectDialog.close()}
					>Cancel</button
				>
				<button type="button" class="danger-button" title="Remove project" onclick={removeProject}
					>Remove project</button
				>
			</div>
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
				<small>Session scope</small>
				<h1 class="selected-project-title">
					{#if selectedProject?.icon}{#if isProjectImage(selectedProject.icon)}<img
								class="title-icon"
								src={selectedProject.icon}
								alt=""
							/>
						{:else}<span class="title-icon">{selectedProject.icon}</span>{/if}{/if}<span
						>{selectedProject?.name ?? 'No project'}</span
					>
				</h1>
			</div>
			<div class="context-actions">
				<LoaderCircle
					class={loading ? 'loading-indicator active' : 'loading-indicator'}
					role="status"
					aria-label="Loading project contents"
					aria-hidden={!loading}
				/>
				{#if activeTab === 'sessions'}<button
						class="icon-button"
						onclick={createSession}
						aria-label="New session"
						title="New session"><Plus size={18} aria-hidden="true" /></button
					>{/if}
			</div>
		</header>
		<div class="tabs" role="tablist">
			<button
				title="Sessions"
				class:active={activeTab === 'sessions'}
				onclick={() => changeTab('sessions')}>Sessions</button
			>
			{#if selectedProject}<button
					title="Workflows"
					class:active={activeTab === 'workflows'}
					onclick={() => changeTab('workflows')}>Workflows</button
				>{/if}
		</div>
		{#if activeTab === 'sessions'}
			<div class="item-list">
				{#each sessions as session}
					<div class="session-row">
						<button
							class="session-select"
							class:active={selectedSession?.sessionId === session.sessionId}
							title={`Open ${session.title || 'Untitled session'}`}
							onclick={() => openSession(session)}
						>
							{#if isProjectImage(session.icon ?? null)}<img
									class="session-icon session-icon-image"
									src={session.icon ?? ''}
									alt=""
								/>
							{:else}<span class="session-icon"
									>{session.icon ?? automaticSessionIcon(session.title)}</span
								>{/if}
							<div class="session-row-copy">
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
							</div>
						</button>
						<button
							class="session-edit"
							aria-label={`Edit ${session.title || 'Untitled session'}`}
							title={`Edit ${session.title || 'Untitled session'}`}
							onclick={(event) => openEditSession(event, session)}
							><Ellipsis size={16} aria-hidden="true" /></button
						>
					</div>
				{/each}
				{#if !loading && sessions.length === 0}<p class="empty">
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
						<button title={`Run ${workflow.name}`} onclick={() => runWorkflow(workflow)}>Run</button
						>
					</article>
				{/each}
			</div>
			<form class="workflow-form" onsubmit={addWorkflow}>
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
			class="add-project-dialog edit-project-dialog"
			aria-labelledby="edit-session-icon-title"
			onclick={(event) => event.target === event.currentTarget && editSessionDialog.close()}
		>
			<header>
				<div>
					<h2 id="edit-session-icon-title">Edit session icon</h2>
					<p>Choose an icon for {editingSession?.title || 'this session'}.</p>
				</div>
			</header>
			<form onsubmit={saveSessionIcon}>
				<fieldset class="project-icon-field">
					<legend>Session icon</legend>
					<div class="project-icon-editor">
						<div class="project-icon-preview">
							{#if isProjectImage(sessionIconPreview())}<img
									src={sessionIconPreview()}
									alt="Session icon preview"
								/>
							{:else}<span>{sessionIconPreview()}</span>{/if}
						</div>
						<div class="project-icon-options">
							<div class="project-icon-upload">
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
										onchange={chooseSessionImage}
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
				{#if sessionEditError}<p class="directory-error" role="alert">{sessionEditError}</p>{/if}
				<div class="edit-project-actions session-icon-actions">
					<button type="submit" title="Save icon" disabled={sessionSaving}>Save icon</button>
				</div>
			</form>
			<button
				class="icon-button"
				aria-label="Close session icon"
				title="Close session icon"
				onclick={() => editSessionDialog.close()}><X size={18} aria-hidden="true" /></button
			>
		</dialog>
	</aside>

	<main class="session-view">
		<header class="session-header">
			<div>
				<small>
					{selectedProject?.rootPath ?? 'No project'}
					{#if branch}<span class="header-branch">{branch}</span>{/if}
				</small>
				<h2 class="selected-session-title">
					{#if selectedSession}{#if isProjectImage(selectedSession.icon ?? null)}<img
								class="title-icon"
								src={selectedSession.icon ?? ''}
								alt=""
							/>
						{:else}<span class="title-icon"
								>{selectedSession.icon ?? automaticSessionIcon(selectedSession.title)}</span
							>{/if}{/if}<span
						>{selectedSession?.title ||
							(selectedSession
								? 'New Hermes Session'
								: selectedProject
									? 'Project workbench'
									: 'Projects · Workflows · Sessions')}</span
					>
				</h2>
			</div>
			<div class="runtime-pill">
				<Circle size={7} fill="currentColor" aria-hidden="true" /> Hermes ACP
			</div>
		</header>
		{#if error}<div class="error" role="alert">{error}</div>{/if}
		{#if selectedSession}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<section
				class="transcript"
				aria-label="Conversation"
				aria-live="polite"
				tabindex="0"
				bind:this={transcriptElement}
				use:followTranscript
			>
				<div class="transcript-content">
					{#each transcript as message}
						<article
							class:assistant={message.role === 'assistant'}
							class:user={message.role === 'user'}
						>
							<div class="avatar">{message.role === 'assistant' ? 'H' : 'You'}</div>
							<div class="message-stack">
								{#if message.role === 'assistant'}
									<div class="message markdown">
										{#if message.images?.length}<div class="message-images">
												{#each message.images as image}<img
														src={`data:${image.mimeType};base64,${image.data}`}
														alt={image.name}
													/>{/each}
											</div>{/if}
										{@html renderMarkdown(message.text)}
									</div>
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
								<div class="message-actions">
									{#if message.role === 'user'}<button
											type="button"
											aria-label="Edit and resend message"
											title="Edit and resend message"
											onclick={() => editMessage(message)}
											><Pencil size={14} aria-hidden="true" /></button
										>{/if}
									<button
										type="button"
										aria-label="Copy message"
										title="Copy message"
										onclick={() => copyMessage(message)}
										><Copy size={14} aria-hidden="true" /></button
									>
									<button
										type="button"
										aria-label="Fork session"
										title="Fork current session"
										disabled={isTurnBusy(delivery)}
										onclick={forkSession}><GitFork size={14} aria-hidden="true" /></button
									>
								</div>
							</div>
						</article>
					{/each}
					<span class="sr-only" aria-live="polite">{messageNotice}</span>
					{#each subagents as tree (tree.id)}
						<details class="subagent-tree" aria-label={tree.title} open>
							<summary>
								<ChevronRight class="disclosure-icon" size={14} aria-hidden="true" />
								<span class="subagent-tree-title">{tree.title}</span>
								<span class="subagent-status" class:active={tree.status === 'in_progress'}
									>{tree.status.replace('_', ' ')}</span
								>
							</summary>
							<div class="subagent-children">
								{#each tree.children as child (child.index)}
									<details class="subagent-child">
										<summary>
											<ChevronRight class="disclosure-icon" size={14} aria-hidden="true" />
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
					{#if pendingAssistant || pendingImages.length}<article class="assistant">
							<div class="avatar">H</div>
							<div class="message markdown">
								{#if pendingImages.length}<div class="message-images">
										{#each pendingImages as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{@html renderMarkdown(
									pendingAssistant
								)}{#if delivery === 'accepted' || delivery === 'running'}<span class="cursor"
										>▋</span
									>{/if}
							</div>
						</article>{/if}
					{#if transcript.length === 0 && !pendingAssistant && !pendingImages.length && !pendingThought}<div
							class="welcome"
						>
							<span>H</span>
							<h2>Start this Hermes Session</h2>
							<p>Your complete message is saved before HUE sends it.</p>
						</div>{/if}
					<div class="transcript-spacer" aria-hidden="true"></div>
				</div>
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
				<button
					type="button"
					class="scroll-to-latest"
					class:visible={showScrollToLatest}
					aria-label="Scroll to latest message"
					aria-hidden={!showScrollToLatest}
					title="Scroll to latest message"
					disabled={!showScrollToLatest}
					tabindex={showScrollToLatest ? 0 : -1}
					onclick={() => scrollToLatest('smooth')}
					><ArrowDown size={16} aria-hidden="true" /></button
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
								title={command.description || `Use /${command.name}`}
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
									<GripVertical class="queue-handle" size={16} aria-hidden="true" />
									<span>{message.text || `${message.images.length} image(s)`}</span>
									{#if message.images.length}<small>+{message.images.length} file(s)</small>{/if}
								</div>
								<div class="queue-actions">
									<span>Waiting</span>
									<button
										type="button"
										aria-label="Edit queued message"
										title="Edit queued message"
										onclick={() => editQueuedMessage(message)}>Edit</button
									>
									<button
										type="button"
										aria-label="Send queued message now"
										title="Send queued message now"
										onclick={stopTurn}>Send now</button
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
									title={`Remove ${image.name}`}
									onclick={() => (images = images.filter((_, item) => item !== index))}
									><X size={14} aria-hidden="true" /></button
								>
							</figure>{/each}
					</div>{/if}
				{#if callActive}<section
						class="voice-call"
						aria-label={voiceMessageOnly ? 'Voice message controls' : 'Voice call controls'}
					>
						<span class="voice-call-state" aria-live="polite">
							<span class:active={!callMuted} aria-hidden="true"></span>
							{callMuted
								? 'Muted'
								: voiceMessageOnly && callStatus === 'listening'
									? 'recording'
									: callStatus}
						</span>
						{#if callError}<span class="voice-call-error" role="alert">{callError}</span>{/if}
						<div>
							{#if voiceMessageOnly}<button
									bind:this={voiceCancelElement}
									type="button"
									class="end-call"
									aria-label="Cancel voice message"
									title="Cancel voice message"
									onclick={() => endVoiceCall()}><X size={17} aria-hidden="true" /></button
								>{:else}<button
									bind:this={callMuteElement}
									type="button"
									aria-pressed={callMuted}
									aria-label={callMuted ? 'Unmute microphone' : 'Mute microphone'}
									title={callMuted ? 'Unmute microphone' : 'Mute microphone'}
									onclick={toggleCallMute}
								>
									{#if callMuted}<MicOff size={17} aria-hidden="true" />{:else}<Mic
											size={17}
											aria-hidden="true"
										/>{/if}
								</button>
								{#if isTurnBusy(delivery) || callStatus === 'speaking'}<button
										type="button"
										aria-label="Interrupt Hermes"
										title="Interrupt Hermes and listen"
										onclick={interruptVoiceCall}
										><Square size={13} fill="currentColor" aria-hidden="true" /></button
									>{/if}
								<button
									type="button"
									class="end-call"
									aria-label="End voice call"
									title="End voice call"
									onclick={() => endVoiceCall()}><PhoneOff size={17} aria-hidden="true" /></button
								>
							{/if}
						</div>
					</section>{/if}
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
						<Paperclip size={20} aria-hidden="true" />
						<input
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							multiple
							onchange={handleImageInput}
						/>
					</label>
					{#if !callActive}<button
							bind:this={voiceMessageElement}
							type="button"
							class="attach-button voice-start"
							aria-label="Record voice message"
							title="Record and send voice message"
							onclick={startVoiceMessage}><Mic size={20} aria-hidden="true" /></button
						>
						<button
							bind:this={voiceStartElement}
							type="button"
							class="attach-button voice-start"
							aria-label="Start voice call"
							title="Start voice call"
							onclick={startVoiceCall}><PhoneCall size={20} aria-hidden="true" /></button
						>{/if}
					<div class="composer-context" aria-label="Hermes session context">
						<span class="context-chip context-profile" title="Active Hermes profile">
							<Sparkles size={14} aria-hidden="true" /><span>{runtime.profile}</span>
						</span>
						{#if runtime.models}<button
								type="button"
								class="context-chip context-select context-model"
								aria-label="Hermes model"
								aria-haspopup="menu"
								aria-expanded={modelMenuOpen}
								popovertarget="hermes-model-menu"
								title="Choose Hermes model"
								disabled={runtimeChanging || isTurnBusy(delivery)}
							>
								<CircleDot size={14} aria-hidden="true" />
								<span>{currentModel()?.name ?? runtime.models.currentModelId}</span>
								<ChevronDown size={13} aria-hidden="true" />
							</button>
							<div
								bind:this={modelPopover}
								id="hermes-model-menu"
								class="model-menu"
								popover="auto"
								role="menu"
								aria-label="Choose Hermes model"
								ontoggle={(event) =>
									(modelMenuOpen = (event.currentTarget as HTMLElement).matches(':popover-open'))}
							>
								<header>
									<strong>Models</strong>
									<span>{runtime.models.availableModels.length} available</span>
								</header>
								{#each modelCategories() as category}
									<details
										open={category.models.some(
											(model) => model.modelId === runtime.models?.currentModelId
										)}
									>
										<summary>
											<span>{category.name}</span>
											<small
												>{category.models.length}
												{category.models.length === 1 ? 'model' : 'models'}</small
											>
											<ChevronRight size={14} aria-hidden="true" />
										</summary>
										<div class="model-options">
											{#each category.models as model}<button
													type="button"
													role="menuitemradio"
													aria-checked={model.modelId === runtime.models?.currentModelId}
													title={`Use ${model.name}`}
													onclick={() => selectModel(model.modelId)}
												>
													<span class="model-check"
														>{#if model.modelId === runtime.models?.currentModelId}<Check
																size={15}
																aria-hidden="true"
															/>{/if}</span
													>
													<span
														><strong>{model.name}</strong>{#if model.description}<small
																>{model.description}</small
															>{/if}</span
													>
												</button>{/each}
										</div>
									</details>
								{/each}
							</div>{/if}
						{#if runtime.modes}<label
								class="context-chip context-select context-mode"
								title="Hermes edit mode"
							>
								<Circle size={14} aria-hidden="true" />
								<select
									aria-label="Hermes mode"
									value={runtime.modes.currentModeId}
									disabled={runtimeChanging || isTurnBusy(delivery)}
									onchange={(event) =>
										changeRuntime('modeId', (event.currentTarget as HTMLSelectElement).value)}
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
							title="Retry exact message"
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
							<Square size={12} fill="currentColor" aria-hidden="true" /></button
						>{:else}<button
							type="submit"
							class="composer-send"
							aria-label="Send"
							title="Send message"
							disabled={!composer.trim() && !images.length}
						>
							<Send size={20} aria-hidden="true" /></button
						>{/if}
				</div>
			</form>
		{:else if selectedProject}
			<section class="project-workbench" aria-label={`${selectedProject.name} workbench`}>
				<article class="workbench-panel browser-panel" aria-label="Project browser">
					<header>
						<div class="browser-tabs" role="tablist" aria-label="Browser tabs">
							{#each browserTabs as tab}
								<div class="browser-tab" class:active={tab.id === activeBrowserTabId}>
									<button
										role="tab"
										aria-selected={tab.id === activeBrowserTabId}
										title={`Open ${tab.title}`}
										onclick={() => (activeBrowserTabId = tab.id)}>{tab.title}</button
									>
									<button
										aria-label={`Close ${tab.title}`}
										title={`Close ${tab.title}`}
										onclick={(event) => closeBrowserTab(event, tab.id)}
										><X size={12} aria-hidden="true" /></button
									>
								</div>
							{/each}
							<button
								class="add-tab"
								title="New browser tab"
								aria-label="New browser tab"
								onclick={addBrowserTab}><Plus size={16} aria-hidden="true" /></button
							>
						</div>
						<form class="browser-address" onsubmit={navigateBrowser}>
							<input
								value={activeBrowserTab()?.draft ?? ''}
								oninput={updateBrowserDraft}
								aria-label="Browser address"
								placeholder="http://localhost:5173"
							/>
							<button type="submit" title="Open address">Go</button>
							{#if activeBrowserTab()?.url}<a
									href={activeBrowserTab().url}
									target="_blank"
									rel="noopener noreferrer"
									title="Open browser tab externally"
									><ExternalLink size={15} aria-hidden="true" /></a
								>{/if}
						</form>
						{#if browserError}<small class="panel-error" role="alert">{browserError}</small>{/if}
					</header>
					{#if activeBrowserTab()?.url}
						<iframe
							title={activeBrowserTab().title}
							src={activeBrowserTab().url}
							sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
						></iframe>
					{:else}
						<div class="panel-empty">
							<strong>Preview a local app or web page</strong><span
								>Sites that block framing can still open externally.</span
							>
						</div>
					{/if}
				</article>

				<article class="workbench-panel terminal-panel" aria-label="Project terminal">
					<header class="terminal-header">
						<div class="terminal-tabs" role="tablist" aria-label="Terminal tabs">
							{#each terminalTabs as tab}
								<div class="terminal-tab" class:active={tab.id === activeTerminalTabId}>
									<button
										role="tab"
										aria-selected={tab.id === activeTerminalTabId}
										title={`Open ${tab.label}`}
										onclick={() => chooseTerminalTab(tab.id)}
									>
										<span>{tab.label}</span><Circle
											size={7}
											fill="currentColor"
											class={tab.status === 'exited' ? 'exited' : ''}
											aria-hidden="true"
										/>
									</button>
									<button
										aria-label={`Close ${tab.label}`}
										title={`Close ${tab.label}`}
										onclick={(event) => closeTerminalTab(event, tab)}
										><X size={12} aria-hidden="true" /></button
									>
								</div>
							{/each}
						</div>
						<button title="New terminal" aria-label="New terminal" onclick={addTerminalTab}
							><Plus size={16} aria-hidden="true" /></button
						>
					</header>
					<div
						class="terminal-screen"
						bind:this={terminalElement}
						role="application"
						aria-label="Interactive project terminal"
					></div>
					{#if terminalError}<p class="panel-error terminal-error" role="alert">
							{terminalError}
						</p>{/if}
				</article>

				<article class="workbench-panel repository-panel" aria-label="Git status">
					<header>
						<div><strong>Git</strong><span>{repository?.branch ?? 'Repository'}</span></div>
						<div class="git-header-actions">
							<button
								title="Push branch"
								disabled={repositoryBusy || !repository?.isRepository}
								onclick={() => mutateRepository({ action: 'push' })}>Push</button
							>
							<button
								title="Refresh Git status"
								aria-label="Refresh Git status"
								disabled={repositoryBusy}
								onclick={loadRepository}><RefreshCw size={15} aria-hidden="true" /></button
							>
						</div>
					</header>
					<div class="repository-content">
						{#if repositoryLoading}<p class="muted" role="status">Reading repository…</p>{/if}
						{#if repositoryError}<p class="panel-error" role="alert">{repositoryError}</p>{/if}
						{#if repository && !repository.isRepository}<div class="panel-empty">
								<strong>Git not detected</strong><span
									>This project is still available to Hermes.</span
								>
							</div>
						{:else if repository?.isRepository}
							<nav class="repository-links" aria-label="Repository options">
								{#each repositoryLinks() as link}<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										title={`Open ${link.label}`}>{link.label}</a
									>{/each}
							</nav>
							<section class="git-section" aria-label="Staged changes">
								<header>
									<strong>Staged changes</strong><span>{stagedChanges().length}</span>
									{#if stagedChanges().length}<button
											title="Unstage all changes"
											disabled={repositoryBusy}
											onclick={() => mutateRepository({ action: 'unstageAll' })}>Unstage all</button
										>{/if}
								</header>
								<ul class="change-list">
									{#each stagedChanges() as change}<li>
											<button
												title={`Unstage ${change.path}`}
												aria-label={`Unstage ${change.path}`}
												disabled={repositoryBusy}
												onclick={() => mutateRepository({ action: 'unstage', path: change.path })}
												><Minus size={14} aria-hidden="true" /></button
											><code>{change.index}</code><span>{change.path}</span>
										</li>{/each}
								</ul>
							</section>
							<section class="git-section" aria-label="Changes">
								<header>
									<strong>Changes</strong><span>{unstagedChanges().length}</span>
									{#if unstagedChanges().length}<button
											title="Stage all changes"
											disabled={repositoryBusy}
											onclick={() => mutateRepository({ action: 'stageAll' })}>Stage all</button
										>{/if}
								</header>
								<ul class="change-list">
									{#each unstagedChanges() as change}<li>
											<button
												title={`Stage ${change.path}`}
												aria-label={`Stage ${change.path}`}
												disabled={repositoryBusy}
												onclick={() => mutateRepository({ action: 'stage', path: change.path })}
												><Plus size={14} aria-hidden="true" /></button
											><code>{change.worktree}</code><span>{change.path}</span>
										</li>{/each}
								</ul>
							</section>
							{#if !repository.changes.length}<div class="panel-empty compact">
									<strong>Working tree clean</strong>
								</div>{/if}
						{/if}
					</div>
					<form
						class="git-commit"
						onsubmit={(event) => {
							event.preventDefault();
							void mutateRepository({ action: 'commit', message: commitMessage });
						}}
					>
						<div>
							<strong>Commit</strong><span
								>{stagedChanges().length
									? `${stagedChanges().length} staged`
									: 'Stage files to commit'}</span
							>
						</div>
						<input
							bind:value={commitMessage}
							aria-label="Commit message"
							placeholder="Commit message"
						/>
						<div>
							{#if repositoryMessage}<small role="status">{repositoryMessage}</small>{/if}
							<button
								type="submit"
								title="Commit staged changes"
								disabled={repositoryBusy || !commitMessage.trim() || !stagedChanges().length}
								>Commit</button
							>
							<button
								type="button"
								title="Commit and push staged changes"
								disabled={repositoryBusy || !commitMessage.trim() || !stagedChanges().length}
								onclick={commitAndPush}>Commit &amp; push</button
							>
						</div>
					</form>
				</article>

				<article class="workbench-panel worktrees-panel" aria-label="Git worktrees">
					<header>
						<strong>Worktrees</strong><span>{repository?.worktrees.length ?? 0}</span>
					</header>
					<div class="worktree-list">
						{#each repository?.worktrees ?? [] as worktree}
							<article>
								<div>
									<strong>{worktree.branch ?? 'Detached HEAD'}</strong><code>{worktree.path}</code>
								</div>
								<small>{worktree.head.slice(0, 7)}</small>
							</article>
						{/each}
						{#if !repositoryLoading && repository?.isRepository && !repository.worktrees.length}<p
								class="muted"
							>
								No linked worktrees.
							</p>{/if}
						{#if !repositoryLoading && repository && !repository.isRepository}<p class="muted">
								Available when this project uses Git.
							</p>{/if}
					</div>
				</article>
			</section>
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
