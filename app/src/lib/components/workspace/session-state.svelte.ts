import { subagentTreesFromEvents, type WorkspaceSubagentTree } from '$lib';
import type { ImageAttachment } from '$lib/message-content';
import type {
	CachedSessionView,
	HermesCommand,
	HermesRuntime,
	Project,
	QueuedMessage,
	Session,
	SessionLoad,
	TranscriptMessage
} from './types';

export class SessionState {
	transcript = $state<TranscriptMessage[]>([]);
	subagents = $state<WorkspaceSubagentTree[]>([]);
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

	cache = (session: Session | null) => {
		if (!session) return;
		this.views.set(this.viewKey(session.sessionId), {
			transcript: [...this.transcript],
			subagents: [...this.subagents],
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
		this.transcript = cached?.transcript ?? [];
		this.subagents = cached?.subagents ?? [];
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
		this.transcript = [];
		this.subagents = [];
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
		this.transcript = body.transcript;
		this.subagents = subagentTreesFromEvents(body.events ?? []);
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
}
