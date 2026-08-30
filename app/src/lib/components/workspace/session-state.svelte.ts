import {
	activityFromEvents,
	applySessionEvents,
	applyTimelineEvents,
	isTurnBusy,
	planFromEvents,
	subagentTreesFromEvents,
	timelineFromSession,
	type WorkspaceActivity,
	type WorkspacePlanEntry,
	type WorkspaceSubagentTree,
	type WorkspaceTimelineItem
} from '$lib';
import type { ImageAttachment } from '$lib/message-content';
import type {
	CachedSessionView,
	HermesCommand,
	HermesRuntime,
	Project,
	QueuedMessage,
	Session,
	SessionEvent,
	SessionLoad,
	TranscriptMessage
} from './types';

export class SessionState {
	timeline = $state<WorkspaceTimelineItem[]>([]);
	transcript = $state<TranscriptMessage[]>([]);
	subagents = $state<WorkspaceSubagentTree[]>([]);
	activity = $state<WorkspaceActivity[]>([]);
	plan = $state<WorkspacePlanEntry[]>([]);
	commands = $state<HermesCommand[]>([]);
	runtime = $state<HermesRuntime>({ profile: 'default' });
	branch = $state<string | null>(null);
	queuedMessages = $state<QueuedMessage[]>([]);
	eventCursor = $state(0);
	activeMessageId = $state('');
	pendingAssistant = $state('');
	pendingImages = $state<ImageAttachment[]>([]);
	pendingThought = $state('');
	delivery = $state('');
	private views = new Map<string, CachedSessionView>();

	constructor(
		private getProject: () => Project | null,
		private setError: (message: string) => void
	) {}

	private viewKey(sessionId: string) {
		return `${this.getProject()?.id ?? 'none'}:${sessionId}`;
	}

	private capturedViewKey(projectId: string | null, sessionId: string) {
		return `${projectId ?? 'none'}:${sessionId}`;
	}

	private loadedView(body: SessionLoad): CachedSessionView {
		return {
			timeline: timelineFromSession(body.transcript, body.messages, body.events ?? []),
			transcript: body.transcript,
			subagents: subagentTreesFromEvents(body.events ?? []),
			activity: activityFromEvents(body.events ?? []),
			plan: planFromEvents(body.events ?? []),
			commands: body.commands ?? [],
			runtime: body.runtime ?? { profile: 'default' },
			branch: body.branch ?? null,
			queuedMessages: body.messages.filter(
				(message): message is QueuedMessage =>
					message.status === 'queued' && message.id !== body.activeTurn?.messageId
			),
			eventCursor: body.cursor,
			activeMessageId: body.activeTurn?.messageId ?? '',
			pendingAssistant: body.activeTurn?.output ?? '',
			pendingImages: body.activeTurn?.images ?? [],
			pendingThought: body.activeTurn?.thought ?? '',
			delivery: body.activeTurn
				? body.activeTurn.status === 'queued'
					? 'accepted'
					: body.activeTurn.status === 'unknown'
						? 'delivery unknown'
						: 'running'
				: ''
		};
	}

	preload = (projectId: string | null, sessionId: string, body: SessionLoad) => {
		const key = this.capturedViewKey(projectId, sessionId);
		if (!this.views.has(key)) this.views.set(key, this.loadedView(body));
	};

	resolveInteraction = (
		projectId: string | null,
		sessionId: string,
		interactionId: string,
		kind: 'permission' | 'clarify',
		status: 'resolved' | 'cancelled',
		current: boolean
	) => {
		const patch = (timeline: WorkspaceTimelineItem[]) =>
			timeline.map((item) =>
				item.kind === kind && 'id' in item && item.id === interactionId ? { ...item, status } : item
			);
		const cached = this.views.get(this.capturedViewKey(projectId, sessionId));
		if (cached) cached.timeline = patch(cached.timeline);
		if (current) this.timeline = patch(this.timeline);
	};

	updateCachedDelivery = (
		projectId: string | null,
		sessionId: string,
		activeMessageId: string,
		delivery: string
	) => {
		const cached = this.views.get(this.capturedViewKey(projectId, sessionId));
		if (cached) Object.assign(cached, { activeMessageId, delivery });
	};

	cache = (session: Session | null) => {
		if (!session) return;
		this.views.set(this.viewKey(session.sessionId), {
			timeline: [...this.timeline],
			transcript: [...this.transcript],
			subagents: [...this.subagents],
			activity: [...this.activity],
			plan: [...this.plan],
			commands: [...this.commands],
			runtime: { ...this.runtime },
			branch: this.branch,
			queuedMessages: [...this.queuedMessages],
			eventCursor: this.eventCursor,
			activeMessageId: this.activeMessageId,
			pendingAssistant: this.pendingAssistant,
			pendingImages: [...this.pendingImages],
			pendingThought: this.pendingThought,
			delivery: this.delivery
		});
	};

	showCached = (session: Session) => {
		const cached = this.views.get(this.viewKey(session.sessionId));
		this.timeline = cached?.timeline ?? [];
		this.transcript = cached?.transcript ?? [];
		this.subagents = cached?.subagents ?? [];
		this.activity = cached?.activity ?? [];
		this.plan = cached?.plan ?? [];
		this.commands = cached?.commands ?? [];
		this.runtime = cached?.runtime ?? { profile: 'default' };
		this.branch = cached?.branch ?? null;
		this.queuedMessages = cached?.queuedMessages ?? [];
		this.eventCursor = cached?.eventCursor ?? 0;
		this.activeMessageId = cached?.activeMessageId ?? '';
		this.pendingAssistant = cached?.pendingAssistant ?? '';
		this.pendingImages = cached?.pendingImages ?? [];
		this.pendingThought = cached?.pendingThought ?? '';
		this.delivery = cached?.delivery ?? '';
	};

	clear = () => {
		this.timeline = [];
		this.transcript = [];
		this.subagents = [];
		this.activity = [];
		this.plan = [];
		this.commands = [];
		this.runtime = { profile: 'default' };
		this.branch = null;
		this.queuedMessages = [];
		this.eventCursor = 0;
		this.activeMessageId = '';
		this.pendingAssistant = '';
		this.pendingImages = [];
		this.pendingThought = '';
		this.delivery = '';
	};

	applyCreated = (body: {
		commands?: HermesCommand[];
		runtime?: HermesRuntime;
		branch?: string | null;
	}) => {
		this.clear();
		this.commands = body.commands ?? [];
		this.runtime = body.runtime ?? { profile: 'default' };
		this.branch = body.branch ?? null;
	};

	applyLoaded = (body: SessionLoad) => {
		const view = this.loadedView(body);
		this.timeline = view.timeline;
		this.transcript = view.transcript;
		this.subagents = view.subagents;
		this.activity = view.activity;
		this.plan = view.plan;
		this.commands = view.commands;
		this.runtime = view.runtime;
		this.branch = view.branch;
		this.queuedMessages = view.queuedMessages;
		this.eventCursor = view.eventCursor;
		this.activeMessageId = view.activeMessageId;
		this.pendingAssistant = view.pendingAssistant;
		this.pendingImages = view.pendingImages;
		this.pendingThought = view.pendingThought;
		this.delivery = view.delivery;
		this.setError(body.transcriptError ?? '');
	};

	applyEvents = (events: SessionEvent[]) => {
		const next = applySessionEvents(
			{
				cursor: this.eventCursor,
				activeMessageId: this.activeMessageId,
				pendingAssistant: this.pendingAssistant,
				pendingImages: this.pendingImages,
				pendingThought: this.pendingThought,
				delivery: this.delivery,
				transcript: this.transcript,
				subagents: this.subagents,
				activity: this.activity,
				plan: this.plan
			},
			events
		);
		const timeline = applyTimelineEvents(
			{ cursor: this.eventCursor, timeline: this.timeline },
			events
		);
		const settled = isTurnBusy(this.delivery) && !isTurnBusy(next.delivery);
		this.eventCursor = next.cursor;
		this.timeline = timeline.timeline;
		this.pendingAssistant = next.pendingAssistant;
		this.pendingImages = next.pendingImages ?? [];
		this.pendingThought = next.pendingThought ?? '';
		this.delivery = next.delivery;
		this.transcript = next.transcript;
		this.subagents = next.subagents ?? [];
		this.activity = next.activity ?? [];
		this.plan = next.plan ?? [];
		return settled;
	};

	previewEvents = (events: SessionEvent[]) => {
		this.timeline = applyTimelineEvents(
			{ cursor: this.eventCursor, timeline: this.timeline },
			events
		).timeline;
	};
}
