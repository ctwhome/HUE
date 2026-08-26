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
		this.pendingAssistant = '';
		this.pendingImages = [];
		this.pendingThought = '';
		this.activeMessageId = '';
		this.delivery = '';
		this.eventCursor = 0;
	};

	applyLoaded = (body: SessionLoad) => {
		this.timeline = timelineFromSession(body.transcript, body.messages, body.events ?? []);
		this.transcript = body.transcript;
		this.subagents = subagentTreesFromEvents(body.events ?? []);
		this.activity = activityFromEvents(body.events ?? []);
		this.plan = planFromEvents(body.events ?? []);
		this.commands = body.commands ?? [];
		this.runtime = body.runtime ?? { profile: 'default' };
		this.branch = body.branch ?? null;
		this.queuedMessages = body.messages.filter(
			(message): message is QueuedMessage =>
				message.status === 'queued' && message.id !== body.activeTurn?.messageId
		);
		this.eventCursor = body.cursor;
		this.activeMessageId = body.activeTurn?.messageId ?? '';
		this.pendingAssistant = body.activeTurn?.output ?? '';
		this.pendingImages = body.activeTurn?.images ?? [];
		this.pendingThought = body.activeTurn?.thought ?? '';
		this.delivery = body.activeTurn
			? body.activeTurn.status === 'queued'
				? 'accepted'
				: body.activeTurn.status === 'unknown'
					? 'delivery unknown'
					: 'running'
			: '';
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
}
