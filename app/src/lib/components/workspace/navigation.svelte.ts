import { tick } from 'svelte';
import { automaticSessionIcon } from '$lib/icon';
import type { CatalogPrompt } from '$lib/prompt-catalog';
import { isCurrentSessionRequest, isCurrentTabRequest } from '$lib';
import type { MobilePane } from './mobile-navigation';
import {
	persistNavigationSelection,
	restoreNavigationSelection,
	isDrawerHistoryEntry,
	type HistoryMode
} from './navigation-history';
import type {
	Api,
	HermesCommand,
	HermesRuntime,
	Project,
	Session,
	SessionLoad,
	Workflow
} from './types';
type NavigationEffects = {
	api: Api;
	getProjects: () => Project[];
	endVoice: () => void;
	cacheSession: () => void;
	saveDraft: () => void;
	clearSession: () => void;
	showCachedSession: (session: Session) => void;
	applyCreatedSession: (
		body: {
			commands?: HermesCommand[];
			runtime?: HermesRuntime;
			branch?: string | null;
		},
		preserveWorkMode?: boolean
	) => void | Promise<void>;
	applyLoadedSession: (body: SessionLoad) => void;
	focusNotificationTarget: (
		events: SessionLoad['events'],
		sourceEventId: string | null
	) => Promise<boolean>;
	stopPolling: () => void;
	startPolling: () => void;
	restoreDraft: () => void;
	beginTranscriptEntryStick: () => void;
	scrollToLatest: () => Promise<void>;
	focusComposer: () => void;
	getDelivery: () => string;
	getRuntimeProfile: () => string;
	sendText: (text: string) => Promise<boolean>;
	setError: (message: string) => void;
	setLoading: (loading: boolean) => void;
	guard: (action: () => void) => boolean;
	isMobile: () => boolean;
	openCapture: (intent: 'capture' | 'share', token: string | null) => Promise<void>;
};
export class WorkspaceNavigation {
	selectedProject = $state<Project | null>(null);
	sessions = $state<Session[]>([]);
	workflows = $state<Workflow[]>([]);
	selectedSession = $state<Session | null>(null);
	activeTab = $state<'sessions' | 'workflows'>('sessions');
	mobileDrawer = $state<MobilePane>(null);
	ready = $state(false);
	loadedSessionListProjectId = $state<string | null | undefined>();
	workflowName = $state('');
	workflowPrompt = $state('');
	workflowFolder = $state('');
	workflowProfile = $state('default');
	workflowWorkMode = $state<'autonomous' | 'live'>('autonomous');
	editSessionMenu = $state<HTMLElement>();
	sessionIconMenu = $state<HTMLElement>();
	sessionIconAnchor = $state<HTMLElement>();
	editingSession = $state<Session | null>(null);
	sessionIcon = $state<string | null>(null);
	sessionTitle = $state('');
	sessionPinned = $state(false);
	sessionArchived = $state(false);
	sessionFolder = $state('');
	sessionTags = $state('');
	sessionSearch = $state('');
	showArchived = $state(false);
	sessionEmojiPickerOpen = $state(false);
	sessionEditError = $state('');
	sessionSaving = $state(false);
	private sessionRequestGeneration = 0;
	private tabRequestGeneration = 0;
	private sessionSaveChain = Promise.resolve();
	private sessionLists = new Map<string, Session[]>();
	private workflowLists = new Map<string, Workflow[]>();
	get sessionSections() {
		return [
			...new Set(this.sessions.flatMap((session) => (session.folder ? [session.folder] : [])))
		].sort((left, right) => left.localeCompare(right));
	}
	constructor(
		initialProject: Project | null,
		private effects: NavigationEffects
	) {
		this.selectedProject = initialProject?.rootAvailable ? initialProject : null;
	}
	sessionApiPath(sessionId?: string, suffix = '') {
		const base = this.selectedProject
			? `/api/projects/${this.selectedProject.id}/sessions`
			: '/api/sessions';
		return `${base}${sessionId ? `/${sessionId}` : ''}${suffix}`;
	}
	captureSessionSelection() {
		if (!this.selectedSession) return null;
		return {
			generation: this.sessionRequestGeneration,
			projectId: this.selectedProject?.id ?? null,
			sessionId: this.selectedSession.sessionId
		};
	}
	isCurrentSessionSelection(selection: {
		generation: number;
		projectId: string | null;
		sessionId: string;
	}) {
		return (
			selection.generation === this.sessionRequestGeneration &&
			selection.projectId === (this.selectedProject?.id ?? null) &&
			selection.sessionId === this.selectedSession?.sessionId
		);
	}
	persistSelection(
		mode: Exclude<HistoryMode, 'none'> = 'replace',
		drawerEntry = false,
		remember = true
	) {
		persistNavigationSelection(this, mode, drawerEntry, remember);
	}
	restoreSelection = async () => {
		const launch = await restoreNavigationSelection(this, this.effects, () =>
			this.effects.guard(() => void this.restoreSelection())
		);
		if (!launch) return false;
		if (launch.intent === 'new-session') await this.createProjectlessSession();
		else if (launch.intent === 'capture' || launch.intent === 'share')
			await this.effects.openCapture(launch.intent, launch.token);
		return true;
	};
	chooseProject = async (project: Project | null, historyMode: HistoryMode = 'push') => {
		if (this.effects.guard(() => void this.chooseProject(project, historyMode))) return;
		const drillingFromProjects = this.effects.isMobile() && this.mobileDrawer === 'projects';
		this.effects.endVoice();
		this.effects.cacheSession();
		this.effects.saveDraft();
		this.sessionRequestGeneration += 1;
		this.effects.stopPolling();
		this.selectedProject = project;
		this.loadedSessionListProjectId = undefined;
		if (!project) this.activeTab = 'sessions';
		this.selectedSession = null;
		this.sessions = this.sessionLists.get(project?.id ?? 'none') ?? [];
		this.workflows = project ? (this.workflowLists.get(project.id) ?? []) : [];
		this.effects.clearSession();
		this.effects.setError('');
		this.mobileDrawer = drillingFromProjects ? 'projects' : null;
		if (historyMode !== 'none')
			this.persistSelection(drillingFromProjects ? 'replace' : historyMode);
		if (project && !project.rootAvailable) return;
		await this.loadActiveTab();
		if (this.effects.isMobile()) this.setMobileDrawer('sessions', 'push');
	};
	openFinderSession = async (project: Project | null, sessionId: string) => {
		const generation = this.sessionRequestGeneration + 1;
		const projectId = project?.id ?? null;
		const isCurrent = () =>
			generation === this.sessionRequestGeneration &&
			projectId === (this.selectedProject?.id ?? null);
		await this.chooseProject(project, 'none');
		if (!isCurrent()) return;
		if (!this.sessions.some((session) => session.sessionId === sessionId)) {
			await this.loadActiveTab(sessionId);
			if (!isCurrent()) return;
		}
		const session = this.sessions.find((candidate) => candidate.sessionId === sessionId);
		if (session) await this.openSession(session, 'push');
	};
	createProjectlessSession = async () => {
		if (this.effects.guard(() => void this.createProjectlessSession())) return;
		await this.chooseProject(null, 'none');
		await this.createSession();
	};
	private currentTabRequest() {
		return {
			generation: this.tabRequestGeneration,
			projectId: this.selectedProject?.id ?? '',
			tab: this.activeTab
		};
	}
	loadActiveTab = async (targetSessionId: string | null = null) => {
		if (this.selectedProject && !this.selectedProject.rootAvailable) return;
		const request = {
			generation: ++this.tabRequestGeneration,
			projectId: this.selectedProject?.id ?? '',
			tab: this.activeTab
		};
		const sessionPath = request.projectId
			? `/api/projects/${request.projectId}/sessions`
			: '/api/sessions';
		this.effects.setLoading(true);
		this.effects.setError('');
		try {
			if (request.tab === 'sessions') {
				const fetchSessions = async (cached = false) => {
					const sessions: Session[] = [];
					let offset = 0;
					for (;;) {
						const query = new URLSearchParams();
						if (targetSessionId) query.set('sessionId', targetSessionId);
						if (cached) query.set('cached', 'true');
						if (offset) {
							query.set('limit', '100');
							query.set('offset', String(offset));
						}
						if (this.sessionSearch.trim()) query.set('q', this.sessionSearch.trim());
						if (this.showArchived) query.set('archived', 'true');
						const body = await this.effects.api<{ sessions: Session[]; hasMore?: boolean }>(
							`${sessionPath}${query.size ? `?${query}` : ''}`
						);
						if (!isCurrentTabRequest(request, this.currentTabRequest())) return null;
						sessions.push(...body.sessions);
						if (targetSessionId || !body.hasMore || !body.sessions.length) return sessions;
						offset += body.sessions.length;
					}
				};
				if (!targetSessionId && this.selectedProject) {
					try {
						const cached = await fetchSessions(true);
						if (!cached) return;
						this.sessions = cached;
						this.sessionLists.set(request.projectId, cached);
						this.loadedSessionListProjectId = request.projectId;
					} catch {
						// An authoritative refresh still follows a missing local cache.
					}
				}
				const sessions = await fetchSessions();
				if (!sessions) return;
				if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
				this.sessions = sessions;
				this.sessionLists.set(request.projectId || 'none', sessions);
				this.loadedSessionListProjectId = request.projectId || null;
				if (this.selectedSession) {
					this.selectedSession =
						this.sessions.find(
							(session) => session.sessionId === this.selectedSession?.sessionId
						) ?? this.selectedSession;
				}
			} else if (this.selectedProject) {
				const body = await this.effects.api<{ workflows: Workflow[] }>(
					`/api/projects/${request.projectId}/workflows`
				);
				if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
				this.workflows = body.workflows;
				this.workflowLists.set(request.projectId, body.workflows);
			} else this.workflows = [];
		} catch (cause) {
			if (isCurrentTabRequest(request, this.currentTabRequest())) {
				this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (isCurrentTabRequest(request, this.currentTabRequest())) this.effects.setLoading(false);
		}
	};
	changeTab = async (tab: 'sessions' | 'workflows') => {
		this.activeTab = tab;
		await this.loadActiveTab();
	};
	loadWorkflows = async (includeArchived = false) => {
		const project = this.selectedProject;
		if (!project?.rootAvailable) return;
		try {
			const body = await this.effects.api<{ workflows: Workflow[] }>(
				`/api/projects/${project.id}/workflows${includeArchived ? '?archived=true' : ''}`
			);
			if (this.selectedProject?.id !== project.id) return;
			this.workflows = body.workflows;
			this.workflowLists.set(project.id, body.workflows);
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	createSession = async (workMode?: 'autonomous' | 'live'): Promise<Session | null> => {
		if (this.effects.guard(() => void this.createSession(workMode))) return null;
		this.effects.endVoice();
		this.effects.saveDraft();
		this.effects.cacheSession();
		const projectId = this.selectedProject?.id ?? null;
		this.effects.setLoading(true);
		try {
			const body = await this.effects.api<{
				session: Session;
				commands?: HermesCommand[];
				runtime?: HermesRuntime;
				branch?: string | null;
			}>(this.sessionApiPath(), {
				method: 'POST',
				...(workMode ? { body: JSON.stringify({ workMode }) } : {})
			});
			if ((this.selectedProject?.id ?? null) !== projectId) return null;
			this.sessions = [body.session, ...this.sessions];
			this.sessionLists.set(projectId ?? 'none', this.sessions);
			this.selectedSession = body.session;
			this.mobileDrawer = null;
			this.persistSelection('push');
			await this.effects.applyCreatedSession(body, Boolean(workMode));
			this.effects.setError('');
			this.effects.restoreDraft();
			this.mobileDrawer = null;
			await tick();
			this.effects.focusComposer();
			return body.session;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return null;
		} finally {
			this.effects.setLoading(false);
		}
	};
	openSession = async (
		session: Session,
		historyMode: HistoryMode = 'replace',
		launchEventId: string | null = null
	) => {
		if (this.effects.guard(() => void this.openSession(session, historyMode, launchEventId)))
			return false;
		if (this.selectedSession?.sessionId !== session.sessionId) this.effects.endVoice();
		const sourceEventId =
			launchEventId ??
			(historyMode === 'none' ? new URL(window.location.href).searchParams.get('event') : null);
		const request = {
			generation: ++this.sessionRequestGeneration,
			projectId: this.selectedProject?.id ?? '',
			sessionId: session.sessionId
		};
		this.effects.saveDraft();
		this.effects.cacheSession();
		this.effects.stopPolling();
		this.selectedSession = session;
		this.effects.restoreDraft();
		this.effects.showCachedSession(session);
		this.effects.beginTranscriptEntryStick();
		await this.effects.scrollToLatest();
		if (
			!this.selectedSession ||
			!isCurrentSessionRequest(request, {
				generation: this.sessionRequestGeneration,
				projectId: this.selectedProject?.id ?? '',
				sessionId: this.selectedSession.sessionId
			})
		)
			return false;
		this.mobileDrawer = null;
		if (historyMode !== 'none') this.persistSelection(historyMode);
		this.effects.setLoading(true);
		this.effects.setError('');
		try {
			const body = await this.effects.api<SessionLoad>(this.sessionApiPath(session.sessionId));
			if (
				!this.selectedSession ||
				!isCurrentSessionRequest(request, {
					generation: this.sessionRequestGeneration,
					projectId: this.selectedProject?.id ?? '',
					sessionId: this.selectedSession.sessionId
				})
			)
				return false;
			this.replaceSession({
				...this.selectedSession,
				workMode: body.workMode ?? this.selectedSession.workMode
			});
			this.effects.applyLoadedSession(body);
			if (session.available === false)
				this.effects.setError(session.recovery ?? 'Hermes Session is unavailable.');
			this.effects.restoreDraft();
			this.mobileDrawer = null;
			this.effects.cacheSession();
			this.effects.beginTranscriptEntryStick();
			await this.effects.scrollToLatest();
			if (sourceEventId) this.persistSelection('replace');
			await this.effects.focusNotificationTarget(body.events, sourceEventId);
			if (body.activeTurn && body.activeTurn.status !== 'unknown') this.effects.startPolling();
			return true;
		} catch (cause) {
			if (request.generation === this.sessionRequestGeneration) {
				this.effects.setError(
					session.available === false
						? (session.recovery ?? 'Hermes Session is unavailable.')
						: cause instanceof Error
							? cause.message
							: String(cause)
				);
			}
			return false;
		} finally {
			if (request.generation === this.sessionRequestGeneration) this.effects.setLoading(false);
		}
	};
	addWorkflow = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!this.selectedProject) return false;
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${this.selectedProject.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify({
						name: this.workflowName,
						prompt: this.workflowPrompt,
						folder: this.workflowFolder,
						profile: this.workflowProfile,
						workMode: this.workflowWorkMode
					})
				}
			);
			this.workflows = [...this.workflows, body.workflow];
			this.workflowLists.set(this.selectedProject.id, this.workflows);
			this.workflowName = '';
			this.workflowPrompt = '';
			this.workflowFolder = '';
			return true;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};
	favoriteCatalogPrompt = async (prompt: CatalogPrompt) => {
		const project = this.selectedProject;
		if (!project) return false;
		const existing = this.workflows.find(
			(workflow) => workflow.name === prompt.title && workflow.prompt === prompt.prompt
		);
		if (existing) return this.updateWorkflow(existing, { favorite: true });
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${project.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify({
						name: prompt.title,
						prompt: prompt.prompt,
						folder: prompt.category,
						favorite: true,
						profile: 'default',
						workMode: 'autonomous'
					})
				}
			);
			if (this.selectedProject?.id !== project.id) return false;
			this.workflows = [...this.workflows, body.workflow];
			this.workflowLists.set(project.id, this.workflows);
			return true;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};
	updateWorkflow = async (
		workflow: Workflow,
		patch: Partial<
			Pick<
				Workflow,
				'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'workMode' | 'archived'
			>
		>
	) => {
		const project = this.selectedProject;
		if (!project) return false;
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${project.id}/workflows/${workflow.id}`,
				{ method: 'PATCH', body: JSON.stringify(patch) }
			);
			if (this.selectedProject?.id !== project.id) return false;
			this.workflows = this.workflows.map((item) =>
				item.id === workflow.id ? body.workflow : item
			);
			this.workflowLists.set(project.id, this.workflows);
			return true;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};
	deleteWorkflow = async (workflow: Workflow) => {
		const project = this.selectedProject;
		if (!project) return false;
		try {
			await this.effects.api(`/api/projects/${project.id}/workflows/${workflow.id}`, {
				method: 'DELETE'
			});
			if (this.selectedProject?.id !== project.id) return false;
			this.workflows = this.workflows.filter((item) => item.id !== workflow.id);
			this.workflowLists.set(project.id, this.workflows);
			return true;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};
	duplicateWorkflow = async (workflow: Workflow) => {
		const project = this.selectedProject;
		if (!project) return false;
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${project.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify({
						name: `${workflow.name} copy`,
						prompt: workflow.prompt,
						folder: workflow.folder,
						favorite: workflow.favorite,
						profile: workflow.profile,
						workMode: workflow.workMode
					})
				}
			);
			if (this.selectedProject?.id !== project.id) return false;
			this.workflows = [...this.workflows, body.workflow];
			this.workflowLists.set(project.id, this.workflows);
			return true;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};
	runWorkflow = async (workflow: Workflow) => {
		if (this.effects.guard(() => void this.runWorkflow(workflow))) return;
		if (workflow.profile !== this.effects.getRuntimeProfile()) {
			this.effects.setError(
				`Workflow requires Hermes profile ${workflow.profile}; restart HUE with HUE_HERMES_PROFILE=${workflow.profile} before running it.`
			);
			return;
		}
		this.activeTab = 'sessions';
		const session = await this.createSession(workflow.workMode);
		if (!session) return;
		await this.effects.sendText(workflow.prompt);
	};
	openEditSession = (event: MouseEvent, session: Session) => {
		event.stopPropagation();
		this.prepareEditingSession(session);
		this.editSessionMenu?.showPopover();
		const trigger = event.currentTarget as HTMLElement;
		void tick().then(() => {
			const menu = this.editSessionMenu;
			if (!menu) return;
			const anchor = trigger.getBoundingClientRect();
			const gap = 8;
			const padding = 12;
			const left = Math.min(
				Math.max(padding, anchor.left),
				window.innerWidth - menu.offsetWidth - padding
			);
			const top =
				anchor.bottom + gap + menu.offsetHeight <= window.innerHeight - padding
					? anchor.bottom + gap
					: Math.max(padding, anchor.top - menu.offsetHeight - gap);
			menu.style.left = `${left}px`;
			menu.style.top = `${top}px`;
		});
	};

	private prepareEditingSession(session: Session) {
		this.editingSession = session;
		this.sessionIcon = session.customIcon ?? null;
		this.sessionTitle = session.title ?? '';
		this.sessionPinned = session.pinned ?? false;
		this.sessionArchived = session.archived ?? false;
		this.sessionFolder = session.folder ?? '';
		this.sessionTags = (session.tags ?? []).join(', ');
		this.sessionEmojiPickerOpen = false;
		this.sessionEditError = '';
	}

	openSessionIconEditor = (event: MouseEvent, session?: Session) => {
		event.stopPropagation();
		this.sessionIconAnchor = event.currentTarget as HTMLElement;
		if (session) this.prepareEditingSession(session);
		if (!this.editingSession) return;
		this.sessionIconMenu?.showPopover();
	};
	archiveSession = async (event: MouseEvent, session: Session) => {
		event.stopPropagation();
		try {
			const body = await this.effects.api<{ session: Session }>(
				this.sessionApiPath(session.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ archived: true }) }
			);
			const updated = { ...session, ...body.session, archived: true };
			this.sessions = this.showArchived
				? this.sessions.map((item) => (item.sessionId === session.sessionId ? updated : item))
				: this.sessions.filter((item) => item.sessionId !== session.sessionId);
			this.sessionLists.set(this.selectedProject?.id ?? 'none', this.sessions);
			if (this.selectedSession?.sessionId === session.sessionId) this.selectedSession = updated;
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	applySessionInfoEvents = (events: SessionLoad['events']) => {
		const selected = this.selectedSession;
		if (!selected) return;
		const event = events.findLast(({ type }) => type === 'session.info_updated');
		if (!event || (event.payload.title !== null && typeof event.payload.title !== 'string')) return;
		const title = event.payload.title as string | null;
		const patch = (session: Session) => ({
			...session,
			title,
			icon: session.customIcon ?? automaticSessionIcon(title)
		});
		this.sessions = this.sessions.map((session) =>
			session.sessionId === selected.sessionId ? patch(session) : session
		);
		this.sessionLists.set(this.selectedProject?.id ?? 'none', this.sessions);
		this.selectedSession = patch(selected);
	};

	sessionIconPreview = () => this.sessionIcon ?? automaticSessionIcon(this.editingSession?.title);

	chooseSessionImage = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
			this.sessionEditError = 'Only PNG, JPEG, GIF, and WebP images are supported';
			return;
		}
		if (file.size > 1024 * 1024) {
			this.sessionEditError = 'Session icon image must be 1 MB or smaller';
			return;
		}
		this.sessionIcon = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
		this.sessionEditError = '';
		await this.saveSessionIcon();
	};

	saveSessionIcon = () => {
		const editingSession = this.editingSession;
		if (!editingSession) return this.sessionSaveChain;
		this.sessionSaveChain = this.sessionSaveChain.then(() =>
			this.persistSession(editingSession, { icon: this.sessionIcon })
		);
		return this.sessionSaveChain;
	};

	saveSession = () => {
		const editingSession = this.editingSession;
		if (!editingSession) return this.sessionSaveChain;
		const input = {
			...(this.sessionTitle !== (editingSession.title ?? '') ? { title: this.sessionTitle } : {}),
			pinned: this.sessionPinned,
			archived: this.sessionArchived,
			folder: this.sessionFolder.trim() || null,
			tags: this.sessionTags
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean)
		};
		this.sessionSaveChain = this.sessionSaveChain.then(() =>
			this.persistSession(editingSession, input)
		);
		return this.sessionSaveChain;
	};

	private persistSession = async (
		editingSession: Session,
		input: Partial<Pick<Session, 'icon' | 'title' | 'pinned' | 'archived' | 'folder' | 'tags'>>
	) => {
		this.sessionSaving = true;
		this.sessionEditError = '';
		try {
			const body = await this.effects.api<{ session?: Session; icon: string | null }>(
				this.sessionApiPath(editingSession.sessionId),
				{
					method: 'PATCH',
					body: JSON.stringify(input)
				}
			);
			const title = body.session?.title ?? input.title ?? editingSession.title;
			const updated = {
				...editingSession,
				...input,
				...(body.session ?? {}),
				customIcon: body.icon,
				icon: body.icon ?? automaticSessionIcon(title)
			};
			this.sessions = this.sessions.map((session) =>
				session.sessionId === updated.sessionId ? updated : session
			);
			if (this.selectedSession?.sessionId === updated.sessionId) this.selectedSession = updated;
		} catch (cause) {
			this.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.sessionSaving = false;
		}
	};

	searchSessionList = async (event?: SubmitEvent) => {
		event?.preventDefault();
		await this.loadActiveTab();
	};

	duplicateSession = async () => {
		if (!this.editingSession) return;
		await this.sessionSaveChain;
		this.sessionSaving = true;
		try {
			const body = await this.effects.api<{ session: Session }>(
				this.sessionApiPath(this.editingSession.sessionId),
				{
					method: 'POST',
					body: JSON.stringify({ title: `${this.editingSession.title ?? 'Untitled Session'} copy` })
				}
			);
			this.prependSession(body.session);
			this.editSessionMenu?.hidePopover();
			await this.openSession(body.session, 'push');
		} catch (cause) {
			this.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.sessionSaving = false;
		}
	};

	deleteSession = async () => {
		if (!this.editingSession) return;
		this.sessionSaving = true;
		try {
			const preview = await this.effects.api<{
				impact: { messages: number; events: number; attachments: number; activeDeliveries: number };
			}>(this.sessionApiPath(this.editingSession.sessionId), { method: 'DELETE' });
			const impact = preview.impact;
			if (
				!window.confirm(
					`Remove ${this.editingSession.title ?? 'Untitled Session'} from HUE?\n\n${impact.messages} messages, ${impact.events} events, ${impact.attachments} attachments. ${impact.activeDeliveries} active deliveries. Hermes transcript remains available outside HUE. Archive is reversible; removal is not.`
				)
			)
				return;
			await this.effects.api(`${this.sessionApiPath(this.editingSession.sessionId)}?confirm=true`, {
				method: 'DELETE'
			});
			const id = this.editingSession.sessionId;
			this.sessions = this.sessions.filter((session) => session.sessionId !== id);
			if (this.selectedSession?.sessionId === id) {
				this.selectedSession = null;
				this.effects.clearSession();
				this.persistSelection();
			}
			this.editSessionMenu?.hidePopover();
		} catch (cause) {
			this.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.sessionSaving = false;
		}
	};

	setMobileDrawer(drawer: Exclude<MobilePane, null>, mode: HistoryMode = 'push') {
		if (this.mobileDrawer === drawer) return;
		this.mobileDrawer = drawer;
		if (mode !== 'none') this.persistSelection(mode, mode === 'push');
	}

	closeMobileDrawer() {
		if (!this.mobileDrawer) return;
		if (isDrawerHistoryEntry()) {
			window.history.back();
			return;
		}
		this.mobileDrawer = null;
		this.persistSelection('replace');
	}

	exportSession = (format: 'markdown' | 'json') => {
		if (!this.editingSession) return;
		const link = document.createElement('a');
		link.href = `${this.sessionApiPath(this.editingSession.sessionId)}?format=${format}`;
		link.download = `hue-${this.editingSession.sessionId}.${format === 'markdown' ? 'md' : 'json'}`;
		link.click();
	};

	prependSession(session: Session) {
		this.sessions = [session, ...this.sessions];
	}

	replaceSession = (session: Session) => {
		this.sessions = this.sessions.map((item) =>
			item.sessionId === session.sessionId ? { ...item, ...session } : item
		);
		if (this.selectedSession?.sessionId === session.sessionId) {
			this.selectedSession = { ...this.selectedSession, ...session };
		}
	};

	setSelectedProject(project: Project) {
		this.selectedProject = project;
	}

	setSessionBusySince(
		sessionId: string,
		busySince: string | null,
		projectId: string | null = this.selectedProject?.id ?? null
	) {
		const key = projectId ?? 'none';
		const sessions = (this.sessionLists.get(key) ?? []).map((session) =>
			session.sessionId === sessionId ? { ...session, busySince } : session
		);
		if (this.sessionLists.has(key)) this.sessionLists.set(key, sessions);
		if ((this.selectedProject?.id ?? null) === projectId) {
			this.sessions = this.sessions.map((session) =>
				session.sessionId === sessionId ? { ...session, busySince } : session
			);
		}
	}
}
