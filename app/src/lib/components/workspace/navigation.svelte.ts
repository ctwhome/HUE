import { tick } from 'svelte';
import { automaticSessionIcon } from '$lib/icon';
import { isCurrentSessionRequest, isCurrentTabRequest } from '$lib';
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
	applyCreatedSession: (body: {
		commands?: HermesCommand[];
		runtime?: HermesRuntime;
		branch?: string | null;
	}) => void;
	applyLoadedSession: (body: SessionLoad) => void;
	stopPolling: () => void;
	startPolling: () => void;
	restoreDraft: () => void;
	beginTranscriptEntryStick: () => void;
	scrollToLatest: () => Promise<void>;
	focusComposer: () => void;
	getDelivery: () => string;
	sendText: (text: string) => Promise<boolean>;
	setError: (message: string) => void;
	setLoading: (loading: boolean) => void;
};

export class WorkspaceNavigation {
	selectedProject = $state<Project | null>(null);
	sessions = $state<Session[]>([]);
	workflows = $state<Workflow[]>([]);
	selectedSession = $state<Session | null>(null);
	activeTab = $state<'sessions' | 'workflows'>('sessions');
	mobileDrawer = $state<'projects' | 'sessions' | null>(null);
	workflowName = $state('');
	workflowPrompt = $state('');
	editSessionDialog = $state<HTMLDialogElement>();
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
	private sessionLists = new Map<string, Session[]>();
	private workflowLists = new Map<string, Workflow[]>();

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

	persistSelection() {
		const url = new URL(window.location.href);
		url.searchParams.set('project', this.selectedProject?.id ?? 'none');
		if (this.selectedSession) url.searchParams.set('session', this.selectedSession.sessionId);
		else url.searchParams.delete('session');
		window.history.replaceState(window.history.state ?? {}, '', url);
		document.title = this.selectedSession?.title ? `${this.selectedSession.title} · HUE` : 'HUE';
	}

	restoreSelection = async () => {
		const params = new URL(window.location.href).searchParams;
		const requestedProject = params.get('project');
		if (!requestedProject && !this.effects.getProjects().length) {
			this.persistSelection();
			return;
		}
		this.selectedProject =
			requestedProject === 'none'
				? null
				: (this.effects.getProjects().find(({ id }) => id === requestedProject) ??
					this.selectedProject);
		if (this.selectedProject && !this.selectedProject.rootAvailable) {
			this.persistSelection();
			return;
		}
		const requestedSession = params.get('session');
		await this.loadActiveTab(requestedSession);
		const session = this.sessions.find(({ sessionId }) => sessionId === requestedSession);
		if (session) await this.openSession(session);
		else this.persistSelection();
	};

	chooseProject = async (project: Project | null) => {
		this.effects.endVoice();
		this.effects.cacheSession();
		this.effects.saveDraft();
		this.sessionRequestGeneration += 1;
		this.effects.stopPolling();
		this.selectedProject = project;
		if (!project) this.activeTab = 'sessions';
		this.selectedSession = null;
		this.sessions = this.sessionLists.get(project?.id ?? 'none') ?? [];
		this.workflows = project ? (this.workflowLists.get(project.id) ?? []) : [];
		this.effects.clearSession();
		this.effects.setError('');
		this.mobileDrawer = 'sessions';
		this.persistSelection();
		if (project && !project.rootAvailable) return;
		await this.loadActiveTab();
	};

	createProjectlessSession = async () => {
		await this.chooseProject(null);
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
		this.effects.setLoading(true);
		this.effects.setError('');
		try {
			if (request.tab === 'sessions') {
				const sessions: Session[] = [];
				let offset = 0;
				for (;;) {
					const query = new URLSearchParams();
					if (targetSessionId) query.set('sessionId', targetSessionId);
					if (offset) {
						query.set('limit', '100');
						query.set('offset', String(offset));
					}
					if (this.sessionSearch.trim()) query.set('q', this.sessionSearch.trim());
					if (this.showArchived) query.set('archived', 'true');
					const body = await this.effects.api<{ sessions: Session[]; hasMore?: boolean }>(
						`${this.sessionApiPath()}${query.size ? `?${query}` : ''}`
					);
					if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
					sessions.push(...body.sessions);
					if (targetSessionId || !body.hasMore || !body.sessions.length) break;
					offset += body.sessions.length;
				}
				if (!isCurrentTabRequest(request, this.currentTabRequest())) return;
				this.sessions = sessions;
				this.sessionLists.set(request.projectId || 'none', sessions);
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

	createSession = async (): Promise<Session | null> => {
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
			}>(this.sessionApiPath(), { method: 'POST' });
			if ((this.selectedProject?.id ?? null) !== projectId) return null;
			this.sessions = [body.session, ...this.sessions];
			this.sessionLists.set(projectId ?? 'none', this.sessions);
			this.selectedSession = body.session;
			this.persistSelection();
			this.effects.applyCreatedSession(body);
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

	openSession = async (session: Session) => {
		if (session.available === false) {
			this.effects.setError(session.recovery ?? 'Hermes Session is unavailable.');
			return;
		}
		if (this.selectedSession?.sessionId !== session.sessionId) this.effects.endVoice();
		const request = {
			generation: ++this.sessionRequestGeneration,
			projectId: this.selectedProject?.id ?? '',
			sessionId: session.sessionId
		};
		this.effects.saveDraft();
		this.effects.cacheSession();
		this.effects.stopPolling();
		this.selectedSession = session;
		this.effects.showCachedSession(session);
		this.effects.beginTranscriptEntryStick();
		await this.effects.scrollToLatest();
		this.persistSelection();
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
				return;
			this.effects.applyLoadedSession(body);
			this.effects.restoreDraft();
			this.mobileDrawer = null;
			this.effects.cacheSession();
			this.effects.beginTranscriptEntryStick();
			await this.effects.scrollToLatest();
			if (body.activeTurn && body.activeTurn.status !== 'unknown') this.effects.startPolling();
		} catch (cause) {
			if (request.generation === this.sessionRequestGeneration) {
				this.effects.setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (request.generation === this.sessionRequestGeneration) this.effects.setLoading(false);
		}
	};

	addWorkflow = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!this.selectedProject) return;
		try {
			const body = await this.effects.api<{ workflow: Workflow }>(
				`/api/projects/${this.selectedProject.id}/workflows`,
				{
					method: 'POST',
					body: JSON.stringify({ name: this.workflowName, prompt: this.workflowPrompt })
				}
			);
			this.workflows = [...this.workflows, body.workflow];
			this.workflowName = '';
			this.workflowPrompt = '';
		} catch (cause) {
			this.effects.setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	runWorkflow = async (workflow: Workflow) => {
		this.activeTab = 'sessions';
		const session = await this.createSession();
		if (session) await this.effects.sendText(workflow.prompt);
	};

	openEditSession = (event: MouseEvent, session: Session) => {
		event.stopPropagation();
		this.editingSession = session;
		this.sessionIcon = session.customIcon ?? null;
		this.sessionTitle = session.title ?? '';
		this.sessionPinned = session.pinned ?? false;
		this.sessionArchived = session.archived ?? false;
		this.sessionFolder = session.folder ?? '';
		this.sessionTags = (session.tags ?? []).join(', ');
		this.sessionEmojiPickerOpen = false;
		this.sessionEditError = '';
		this.editSessionDialog?.showModal();
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
	};

	saveSession = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!this.editingSession) return;
		this.sessionSaving = true;
		this.sessionEditError = '';
		try {
			const body = await this.effects.api<{ session?: Session; icon: string | null }>(
				this.sessionApiPath(this.editingSession.sessionId),
				{
					method: 'PATCH',
					body: JSON.stringify({
						icon: this.sessionIcon,
						title: this.sessionTitle,
						pinned: this.sessionPinned,
						archived: this.sessionArchived,
						folder: this.sessionFolder.trim() || null,
						tags: this.sessionTags
							.split(',')
							.map((tag) => tag.trim())
							.filter(Boolean)
					})
				}
			);
			const updated = {
				...this.editingSession,
				...(body.session ?? {}),
				customIcon: body.icon,
				icon: body.icon ?? automaticSessionIcon(this.editingSession.title)
			};
			this.sessions = this.sessions.map((session) =>
				session.sessionId === updated.sessionId ? updated : session
			);
			if (this.selectedSession?.sessionId === updated.sessionId) this.selectedSession = updated;
			this.editSessionDialog?.close();
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
			this.editSessionDialog?.close();
			await this.openSession(body.session);
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
			this.editSessionDialog?.close();
		} catch (cause) {
			this.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.sessionSaving = false;
		}
	};

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

	setSelectedProject(project: Project) {
		this.selectedProject = project;
	}

	setSessionBusySince(sessionId: string, busySince: string | null) {
		this.sessions = this.sessions.map((session) =>
			session.sessionId === sessionId ? { ...session, busySince } : session
		);
	}
}
