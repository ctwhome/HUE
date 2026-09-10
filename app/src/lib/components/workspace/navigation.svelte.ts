import { tick } from 'svelte';
import { automaticSessionIcon } from '$lib/icon';
import type { CatalogPrompt } from '$lib/prompt-catalog';
import type { SessionHarness } from '$lib/session-harness';
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
	ExternalCronJob,
	HermesCommand,
	HermesBundle,
	HermesRuntime,
	Project,
	Session,
	SessionCollection,
	SessionLoad,
	Workflow
} from './types';
type NavigationEffects = {
	api: Api;
	getProjects: () => Project[];
	adjustChatSessionCount: (change: number) => void;
	adjustCronSessionCount: (change: number) => void;
	refreshProjects: () => Promise<void>;
	endVoice: () => void;
	cacheSession: () => void;
	saveDraft: () => void;
	clearSession: () => void;
	clearSessionState: () => void;
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
	sessionCollection = $state<SessionCollection>('chats');
	sessions = $state<Session[]>([]);
	externalCronJobs = $state<ExternalCronJob[]>([]);
	externalCronError = $state('');
	selectedExternalCronJob = $state<ExternalCronJob | null>(null);
	workflows = $state<Workflow[]>([]);
	selectedSession = $state<Session | null>(null);
	removedSession = $state<{ projectId: string | null; sessionId: string } | null>(null);
	activeTab = $state<'sessions' | 'workflows'>('sessions');
	mobileDrawer = $state<MobilePane>(null);
	ready = $state(false);
	creatingSession = $state(false);
	composingSession = $state(false);
	newSessionHarness = $state<SessionHarness>('hermes');
	loadedSessionListProjectId = $state<string | null | undefined>();
	workflowName = $state('');
	workflowPrompt = $state('');
	workflowFolder = $state('');
	workflowProfile = $state('default');
	workflowBundle = $state('autonomous');
	workflowSaving = $state(false);
	workflowError = $state('');
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
	private restoreRequestGeneration = 0;
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
		const restore = ++this.restoreRequestGeneration;
		let started = false;
		const launch = await restoreNavigationSelection(
			this,
			this.effects,
			() => this.effects.guard(() => void this.restoreSelection()),
			() => {
				if (!started) {
					started = true;
					this.sessionRequestGeneration++;
					this.tabRequestGeneration++;
					this.loadedSessionListProjectId = undefined;
				}
				const session = this.sessionRequestGeneration;
				return () =>
					restore === this.restoreRequestGeneration && session === this.sessionRequestGeneration;
			}
		);
		if (!launch) return false;
		if (launch.intent === 'new-session') await this.createProjectlessSession();
		else if (launch.intent === 'capture' || launch.intent === 'share')
			await this.effects.openCapture(launch.intent, launch.token);
		return true;
	};
	chooseProject = async (
		project: Project | null,
		historyMode: HistoryMode = 'push',
		collection: SessionCollection = 'chats',
		targetSessionId: string | null = null
	) => {
		if (
			this.effects.guard(() =>
				void this.chooseProject(project, historyMode, collection, targetSessionId)
			)
		)
			return;
		const drillingFromProjects = this.effects.isMobile() && this.mobileDrawer === 'projects';
		this.effects.endVoice();
		this.effects.cacheSession();
		this.effects.saveDraft();
		this.sessionRequestGeneration += 1;
		this.tabRequestGeneration += 1;
		this.effects.stopPolling();
		this.selectedProject = project;
		this.sessionCollection = project ? 'chats' : collection;
		this.selectedExternalCronJob = null;
		this.externalCronJobs = [];
		this.externalCronError = '';
		this.loadedSessionListProjectId = undefined;
		if (!project || targetSessionId) this.activeTab = 'sessions';
		this.selectedSession = null;
		this.composingSession = false;
		this.newSessionHarness = 'hermes';
		this.sessions = this.sessionLists.get(project?.id ?? this.sessionCollection) ?? [];
		this.workflows = project ? (this.workflowLists.get(project.id) ?? []) : [];
		this.effects.clearSession();
		this.effects.setError('');
		this.mobileDrawer = drillingFromProjects ? 'projects' : null;
		if (historyMode !== 'none')
			this.persistSelection(drillingFromProjects ? 'replace' : historyMode);
		if (project && !project.rootAvailable) {
			if (this.effects.isMobile()) this.mobileDrawer = null;
			return;
		}
		if (this.effects.isMobile() && !targetSessionId) this.setMobileDrawer('sessions', 'push');
		await this.loadActiveTab(targetSessionId);
	};
	chooseSessionCollection = (collection: SessionCollection, historyMode: HistoryMode = 'push') =>
		this.chooseProject(null, historyMode, collection);
	openExternalCronJob = (job: ExternalCronJob, historyMode: HistoryMode = 'push') => {
		if (this.effects.guard(() => this.openExternalCronJob(job, historyMode))) return;
		this.effects.endVoice();
		this.effects.cacheSession();
		this.effects.saveDraft();
		this.sessionRequestGeneration += 1;
		this.effects.stopPolling();
		this.selectedProject = null;
		this.sessionCollection = 'cron';
		this.selectedSession = null;
		this.composingSession = false;
		this.selectedExternalCronJob = job;
		this.effects.clearSession();
		this.effects.setError('');
		this.mobileDrawer = null;
		if (historyMode !== 'none') this.persistSelection(historyMode);
	};
	openFinderSession = async (
		project: Project | null,
		sessionId: string,
		collection: SessionCollection = 'chats'
	) => {
		if (this.effects.guard(() => void this.openFinderSession(project, sessionId, collection)))
			return;
		const generation = this.sessionRequestGeneration + 1;
		const projectId = project?.id ?? null;
		const isCurrent = () =>
			generation === this.sessionRequestGeneration &&
			projectId === (this.selectedProject?.id ?? null);
		await this.chooseProject(project, 'none', collection, sessionId);
		if (!isCurrent()) return;
		const session = this.sessions.find((candidate) => candidate.sessionId === sessionId);
		if (session) {
			const opening = this.openSession(session, 'push');
			void this.loadActiveTab();
			await opening;
		} else void this.loadActiveTab();
	};
	createProjectlessSession = async () => {
		if (this.effects.guard(() => void this.createProjectlessSession())) return;
		await this.chooseProject(null, 'none');
		this.beginSession();
	};
	beginSession = async () => {
		if (this.effects.guard(() => void this.beginSession())) return;
		this.effects.endVoice();
		this.effects.saveDraft();
		this.effects.cacheSession();
		this.effects.stopPolling();
		this.sessionRequestGeneration += 1;
		this.selectedExternalCronJob = null;
		this.selectedSession = null;
		this.composingSession = true;
		this.newSessionHarness = 'hermes';
		this.effects.clearSessionState();
		this.effects.setError('');
		this.mobileDrawer = null;
		this.persistSelection('push');
		await tick();
		this.effects.focusComposer();
	};
	private currentTabRequest() {
		return {
			generation: this.tabRequestGeneration,
			projectId: this.selectedProject?.id ?? this.sessionCollection,
			tab: this.activeTab
		};
	}
	loadActiveTab = async (targetSessionId: string | null = null) => {
		if (this.selectedProject && !this.selectedProject.rootAvailable) return;
		const request = {
			generation: ++this.tabRequestGeneration,
			projectId: this.selectedProject?.id ?? this.sessionCollection,
			tab: this.activeTab
		};
		const sessionPath = this.selectedProject
			? `/api/projects/${request.projectId}/sessions`
			: '/api/sessions';
		const projectId = this.selectedProject?.id ?? null;
		const collection = this.sessionCollection;
		const search = this.sessionSearch.trim();
		const archived = this.showArchived;
		this.loadedSessionListProjectId = undefined;
		this.effects.setLoading(true);
		this.effects.setError('');
		try {
			if (request.tab === 'sessions') {
				const fetchSessions = async (cached = false) => {
					const sessions: Session[] = [];
					let offset = 0;
					let reconciled = false;
					for (;;) {
						const query = new URLSearchParams();
						if (targetSessionId) query.set('sessionId', targetSessionId);
						if (!projectId)
							query.set('scope', collection === 'cron' ? 'scheduled' : 'unscheduled');
						if (cached || offset || targetSessionId) query.set('cached', 'true');
						if (offset) {
							query.set('limit', '100');
							query.set('offset', String(offset));
						}
						if (search && !targetSessionId) query.set('q', search);
						if (archived && !targetSessionId) query.set('archived', 'true');
						const body = await this.effects.api<{
							sessions: Session[];
							hasMore?: boolean;
							projectId: string | null;
							reconciliation: 'cached' | 'complete';
							externalCronJobs?: ExternalCronJob[];
							externalCronError?: unknown;
						}>(`${sessionPath}${query.size ? `?${query}` : ''}`);
						if (!isCurrentTabRequest(request, this.currentTabRequest())) return null;
						if (!offset) reconciled = body.reconciliation === 'complete';
						if (!projectId && collection === 'cron') {
							if (Array.isArray(body.externalCronJobs))
								this.externalCronJobs = body.externalCronJobs;
							if ('externalCronError' in body)
								this.externalCronError =
									typeof body.externalCronError === 'string' ? body.externalCronError : '';
						}
						sessions.push(...body.sessions);
						this.sessions = targetSessionId
							? [
									...this.sessions.filter(
										(session) => !sessions.some((item) => item.sessionId === session.sessionId)
									),
									...sessions
								]
							: [...sessions];
						this.sessionLists.set(request.projectId, this.sessions);
						if (targetSessionId || !body.hasMore || !body.sessions.length) {
							if (
								!targetSessionId && !cached && reconciled && !body.hasMore && !search && !archived
							)
								this.loadedSessionListProjectId = body.projectId ?? request.projectId;
							return sessions;
						}
						offset += body.sessions.length;
					}
				};
				if (!targetSessionId) {
					try {
						const cached = await fetchSessions(true);
						if (!cached) return;
					} catch {
						// An authoritative refresh still follows a missing local cache.
					}
				}
				if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
				const sessions = await fetchSessions();
				if (!sessions) return;
				if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
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
	createSession = async (
		workMode?: 'autonomous' | 'live',
		harness?: SessionHarness
	): Promise<Session | null> => {
		if (this.effects.guard(() => void this.createSession(workMode, harness))) return null;
		if (this.creatingSession) return null;
		const generation = ++this.sessionRequestGeneration;
		const replacingSession = this.selectedSession !== null;
		this.effects.endVoice();
		this.effects.saveDraft();
		this.effects.cacheSession();
		this.effects.stopPolling();
		const projectId = this.selectedProject?.id ?? null;
		const pendingSession: Session = {
			sessionId: `pending-${crypto.randomUUID()}`,
			cwd: this.selectedProject?.primaryPath ?? '',
			title: 'New Session',
			harness: harness ?? 'hermes',
			pending: true,
			...(workMode ? { workMode } : {})
		};
		this.selectedSession = pendingSession;
		if (replacingSession) {
			this.effects.clearSession();
			this.effects.restoreDraft();
		} else this.effects.clearSessionState();
		this.mobileDrawer = null;
		this.effects.setError('');
		this.creatingSession = true;
		this.effects.setLoading(true);
		try {
			const request = this.effects.api<{
				session: Session;
				commands?: HermesCommand[];
				runtime?: HermesRuntime;
				branch?: string | null;
			}>(this.sessionApiPath(), {
				method: 'POST',
				...(workMode || harness ? { body: JSON.stringify({ workMode, harness }) } : {})
			});
			await tick();
			if (generation === this.sessionRequestGeneration && this.selectedSession?.sessionId === pendingSession.sessionId)
				this.effects.focusComposer();
			const body = await request;
			if ((this.selectedProject?.id ?? null) !== projectId) return null;
			this.prependSession(body.session);
			if (this.selectedSession?.sessionId !== pendingSession.sessionId) return body.session;
			this.selectedSession = body.session;
			this.composingSession = false;
			this.mobileDrawer = null;
			this.persistSelection('push');
			this.effects.saveDraft();
			const selection = this.captureSessionSelection();
			await this.effects.applyCreatedSession(body, Boolean(workMode));
			if (!selection || !this.isCurrentSessionSelection(selection)) return body.session;
			this.effects.setError('');
			this.mobileDrawer = null;
			await tick();
			if (!this.isCurrentSessionSelection(selection)) return body.session;
			this.effects.focusComposer();
			return body.session;
		} catch (cause) {
			if (
				(this.selectedProject?.id ?? null) === projectId &&
				this.selectedSession?.sessionId === pendingSession.sessionId
			) {
				this.selectedSession = null;
				this.persistSelection('replace');
			}
			if (generation === this.sessionRequestGeneration)
				this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			return null;
		} finally {
			this.creatingSession = false;
			if (generation === this.sessionRequestGeneration) this.effects.setLoading(false);
		}
	};
	openSession = async (
		session: Session,
		historyMode: HistoryMode = 'replace',
		launchEventId: string | null = null
	) => {
		if (this.effects.guard(() => void this.openSession(session, historyMode, launchEventId)))
			return false;
		const changingSession = this.selectedSession?.sessionId !== session.sessionId;
		if (changingSession) this.effects.endVoice();
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
		this.selectedExternalCronJob = null;
		this.selectedSession = session;
		this.composingSession = false;
		if (changingSession) {
			this.effects.clearSession();
			this.effects.restoreDraft();
		}
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
			if (session.unreadAttention) {
				await this.effects
					.api(this.sessionApiPath(session.sessionId), {
						method: 'PATCH',
						body: JSON.stringify({ read: true })
					})
					.then(() => {
						if (
							this.selectedSession?.sessionId !== session.sessionId ||
							(this.selectedProject?.id ?? '') !== request.projectId
						)
							return;
						this.replaceSession({ ...this.selectedSession, unreadAttention: false });
						return this.effects.refreshProjects();
					})
					.catch(() => undefined);
			}
			if (request.generation !== this.sessionRequestGeneration) return false;
			if (session.available === false)
				this.effects.setError(session.recovery ?? 'Hermes Session is unavailable.');
			this.mobileDrawer = null;
			this.effects.cacheSession();
			this.effects.beginTranscriptEntryStick();
			await this.effects.scrollToLatest();
			if (request.generation !== this.sessionRequestGeneration) return false;
			if (sourceEventId) this.persistSelection('replace');
			await this.effects.focusNotificationTarget(body.events, sourceEventId);
			if (request.generation !== this.sessionRequestGeneration) return false;
			if (['saving', 'accepted', 'running', 'reconnecting', 'cancelling'].includes(this.effects.getDelivery())) this.effects.startPolling();
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
		const project = this.selectedProject;
		if (!project || this.workflowSaving) return false;
		const draft = {
			name: this.workflowName,
			prompt: this.workflowPrompt,
			folder: this.workflowFolder,
			profile: this.workflowProfile,
			bundle: this.workflowBundle
		};
		this.workflowLists.set(project.id, this.workflows);
		this.workflowSaving = true;
		this.workflowError = '';
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${project.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify(draft)
				}
			);
			const current = this.selectedProject?.id === project.id;
			const items = [
				...(current ? this.workflows : (this.workflowLists.get(project.id) ?? [])),
				body.workflow
			];
			this.workflowLists.set(project.id, items);
			if (current) this.workflows = items;
			return true;
		} catch (cause) {
			this.workflowError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			this.workflowSaving = false;
		}
	};
	favoriteCatalogPrompt = async (prompt: CatalogPrompt) => {
		const project = this.selectedProject;
		if (!project || this.workflowSaving) return false;
		const existing = this.workflows.find(
			(workflow) => workflow.name === prompt.title && workflow.prompt === prompt.prompt
		);
		if (existing) return this.updateWorkflow(existing, { favorite: true });
		this.workflowLists.set(project.id, this.workflows);
		this.workflowSaving = true;
		this.workflowError = '';
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
						bundle: 'autonomous'
					})
				}
			);
			const current = this.selectedProject?.id === project.id;
			const items = [
				...(current ? this.workflows : (this.workflowLists.get(project.id) ?? [])),
				body.workflow
			];
			this.workflowLists.set(project.id, items);
			if (current) this.workflows = items;
			return true;
		} catch (cause) {
			this.workflowError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			this.workflowSaving = false;
		}
	};
	updateWorkflow = async (
		workflow: Workflow,
		patch: Partial<
			Pick<Workflow, 'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'bundle' | 'archived'>
		>
	) => {
		const project = this.selectedProject;
		if (!project || this.workflowSaving) return false;
		this.workflowLists.set(project.id, this.workflows);
		this.workflowSaving = true;
		this.workflowError = '';
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${project.id}/workflows/${workflow.id}`,
				{ method: 'PATCH', body: JSON.stringify(patch) }
			);
			const current = this.selectedProject?.id === project.id;
			const items = (current ? this.workflows : (this.workflowLists.get(project.id) ?? [])).map(
				(item) => (item.id === workflow.id ? body.workflow : item)
			);
			this.workflowLists.set(project.id, items);
			if (current) this.workflows = items;
			return true;
		} catch (cause) {
			this.workflowError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			this.workflowSaving = false;
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
		if (!project || this.workflowSaving) return false;
		this.workflowLists.set(project.id, this.workflows);
		this.workflowSaving = true;
		this.workflowError = '';
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
						bundle: workflow.bundle
					})
				}
			);
			const current = this.selectedProject?.id === project.id;
			const items = [
				...(current ? this.workflows : (this.workflowLists.get(project.id) ?? [])),
				body.workflow
			];
			this.workflowLists.set(project.id, items);
			if (current) this.workflows = items;
			return true;
		} catch (cause) {
			this.workflowError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			this.workflowSaving = false;
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
		if (!workflow.bundle.trim()) {
			this.effects.setError('Choose a Hermes bundle before running this Workflow.');
			return;
		}
		let bundle: HermesBundle | undefined;
		try {
			const body = await this.effects.api<{ bundles: HermesBundle[] }>('/api/hermes/bundles');
			bundle = body.bundles.find(({ slug }) => slug === workflow.bundle);
		} catch (cause) {
			this.effects.setError(
				`Could not validate Hermes bundle ${workflow.bundle}: ${cause instanceof Error ? cause.message : String(cause)}`
			);
			return;
		}
		if (!bundle) {
			this.effects.setError(
				`Hermes bundle ${workflow.bundle} is unavailable. Choose an installed bundle and try again.`
			);
			return;
		}
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundle.slug)) {
			this.effects.setError(`Hermes bundle ${workflow.bundle} has an invalid command slug.`);
			return;
		}
		this.activeTab = 'sessions';
		const session = await this.createSession();
		if (!session) return;
		await this.effects.sendText(`/${bundle.slug} ${workflow.prompt}`);
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
			if (!session.archived) this.adjustSessionCount(-1);
			this.sessions = this.showArchived
				? this.sessions.map((item) => (item.sessionId === session.sessionId ? updated : item))
				: this.sessions.filter((item) => item.sessionId !== session.sessionId);
			this.sessionLists.set(this.selectedProject?.id ?? this.sessionCollection, this.sessions);
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
		this.sessionLists.set(this.selectedProject?.id ?? this.sessionCollection, this.sessions);
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
			if (updated.archived !== editingSession.archived) {
				this.adjustSessionCount(updated.archived ? -1 : 1);
			}
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
					`Remove ${this.editingSession.title ?? 'Untitled Session'} from HUE?\n\n${impact.messages} messages, ${impact.events} events, ${impact.attachments} attachments. ${impact.activeDeliveries} active deliveries. The harness transcript remains available outside HUE. Archive is reversible; removal is not.`
				)
			)
				return;
			await this.effects.api(`${this.sessionApiPath(this.editingSession.sessionId)}?confirm=true`, {
				method: 'DELETE'
			});
			const id = this.editingSession.sessionId;
			if (!this.editingSession.archived) this.adjustSessionCount(-1);
			this.sessions = this.sessions.filter((session) => session.sessionId !== id);
			this.sessionLists.set(this.selectedProject?.id ?? this.sessionCollection, this.sessions);
			if (this.selectedSession?.sessionId === id) {
				this.selectedSession = null;
				this.effects.clearSession();
				this.persistSelection();
			}
			this.removedSession = { projectId: this.selectedProject?.id ?? null, sessionId: id };
			this.editSessionMenu?.hidePopover();
		} catch (cause) {
			this.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.sessionSaving = false;
		}
	};
	deleteSessionFromRow = (event: MouseEvent, session: Session) => {
		event.stopPropagation();
		this.prepareEditingSession(session);
		return this.deleteSession();
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
		this.sessionLists.set(this.selectedProject?.id ?? this.sessionCollection, this.sessions);
		if (!session.archived) this.adjustSessionCount(1);
	}

	private adjustSessionCount(change: number) {
		if (this.selectedProject) {
			this.selectedProject.sessionCount = Math.max(0, this.selectedProject.sessionCount + change);
		} else if (this.sessionCollection === 'cron') this.effects.adjustCronSessionCount(change);
		else this.effects.adjustChatSessionCount(change);
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
		const key = projectId ?? this.sessionCollection;
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
