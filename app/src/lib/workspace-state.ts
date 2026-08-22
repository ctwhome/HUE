import type { ImageAttachment } from './message-content';

export type WorkspaceTranscriptMessage = {
	role: 'user' | 'assistant';
	text: string;
	images?: ImageAttachment[];
};
export type WorkspaceSubagentTree = {
	messageId: string;
	id: string;
	title: string;
	status: string;
	children: Array<{ index: number; goal: string; role?: string; status: string; result?: string }>;
};
export type WorkspaceSessionEvent = {
	sequence: number;
	type: string;
	payload: Record<string, unknown>;
	createdAt?: string;
};
export type WorkspacePlanEntry = { content: string; priority: string; status: string };
export type WorkspaceActivity = {
	kind: 'tool' | 'subagents' | 'permission' | 'clarify';
	id: string;
	status: string;
	createdAt?: string;
	messageId?: string;
	name?: string;
	title?: string;
	args?: unknown;
	result?: unknown;
	error?: string;
	durationMs?: number;
	children?: WorkspaceSubagentTree['children'];
	toolCall?: { title?: string; args?: unknown };
	options?: Array<{ optionId: string; name: string; kind: string }>;
	message?: string;
	fields?: Array<{
		name: string;
		label: string;
		control: 'single' | 'multi' | 'text';
		required: boolean;
		options?: Array<{ value: string; label: string }>;
	}>;
};
export type WorkspaceTimelineItem =
	| (WorkspaceTranscriptMessage & {
			sequence: number;
			kind: 'message';
			messageId?: string;
	  })
	| (WorkspaceActivity & { sequence: number })
	| {
			sequence: number;
			kind: 'plan';
			messageId?: string;
			entries: WorkspacePlanEntry[];
	  }
	| { sequence: number; kind: 'thought'; messageId?: string; text: string };
export type WorkspaceDeliveryState = {
	cursor: number;
	activeMessageId: string;
	pendingAssistant: string;
	pendingImages?: ImageAttachment[];
	pendingThought?: string;
	delivery: string;
	transcript: WorkspaceTranscriptMessage[];
	subagents?: WorkspaceSubagentTree[];
	activity?: WorkspaceActivity[];
	plan?: WorkspacePlanEntry[];
};

const ACTIVITY_TYPES = new Map([
	['agent.tool', 'tool'],
	['agent.subagents', 'subagents'],
	['agent.permission', 'permission'],
	['agent.clarify', 'clarify']
] as const);

function upsertActivity(
	activity: WorkspaceActivity[],
	event: WorkspaceSessionEvent
): WorkspaceActivity[] {
	const kind = ACTIVITY_TYPES.get(event.type as never);
	const id = String(event.payload.id ?? '');
	if (!kind || !id) return activity;
	const item = {
		...event.payload,
		kind,
		id,
		status: String(event.payload.status ?? ''),
		createdAt: event.createdAt
	} as WorkspaceActivity;
	const index = activity.findIndex((candidate) => candidate.kind === kind && candidate.id === id);
	if (index < 0) return [...activity, item];
	const next = [...activity];
	next[index] = { ...next[index], ...item, createdAt: next[index].createdAt ?? item.createdAt };
	return next;
}

export function activityFromEvents(events: WorkspaceSessionEvent[]): WorkspaceActivity[] {
	return events.reduce(upsertActivity, [] as WorkspaceActivity[]);
}

function applyTimelineEvent(
	timeline: WorkspaceTimelineItem[],
	event: WorkspaceSessionEvent
): WorkspaceTimelineItem[] {
	const messageId = String(event.payload.messageId ?? '');
	if (event.type === 'message.accepted') {
		const index = timeline.findIndex(
			(item) => item.kind === 'message' && item.role === 'user' && item.messageId === messageId
		);
		if (index < 0) return timeline;
		const next = [...timeline];
		next[index] = { ...next[index], sequence: event.sequence } as WorkspaceTimelineItem;
		return next.sort((left, right) => left.sequence - right.sequence);
	}
	if (event.type === 'agent.chunk' || event.type === 'agent.image') {
		const last = timeline.at(-1);
		const canPatch =
			last?.kind === 'message' && last.role === 'assistant' && last.messageId === messageId;
		const image = event.payload.image as ImageAttachment | undefined;
		if (canPatch) {
			const next = [...timeline];
			next[next.length - 1] = {
				...last,
				text: last.text + (event.type === 'agent.chunk' ? String(event.payload.text ?? '') : ''),
				...(image ? { images: [...(last.images ?? []), image] } : {})
			};
			return next;
		}
		return [
			...timeline,
			{
				sequence: event.sequence,
				kind: 'message',
				role: 'assistant',
				messageId,
				text: event.type === 'agent.chunk' ? String(event.payload.text ?? '') : '',
				...(image ? { images: [image] } : {})
			}
		];
	}
	if (event.type === 'agent.thought') {
		const last = timeline.at(-1);
		if (last?.kind === 'thought' && last.messageId === messageId) {
			const next = [...timeline];
			next[next.length - 1] = {
				...last,
				text: last.text + String(event.payload.text ?? '')
			};
			return next;
		}
		return [
			...timeline,
			{
				sequence: event.sequence,
				kind: 'thought',
				messageId,
				text: String(event.payload.text ?? '')
			}
		];
	}
	if (event.type === 'agent.plan' && Array.isArray(event.payload.entries)) {
		const index = timeline.findIndex(
			(item) => item.kind === 'plan' && item.messageId === messageId
		);
		const item: WorkspaceTimelineItem = {
			sequence: index < 0 ? event.sequence : timeline[index].sequence,
			kind: 'plan',
			messageId,
			entries: event.payload.entries as WorkspacePlanEntry[]
		};
		if (index < 0) return [...timeline, item];
		const next = [...timeline];
		next[index] = item;
		return next;
	}
	const kind = ACTIVITY_TYPES.get(event.type as never);
	const id = String(event.payload.id ?? '');
	if (!kind || !id) return timeline;
	const index = timeline.findIndex((item) => item.kind === kind && 'id' in item && item.id === id);
	const previous = index < 0 ? null : timeline[index];
	const item = {
		...(previous ?? {}),
		...event.payload,
		sequence: previous?.sequence ?? event.sequence,
		kind,
		id,
		status: String(event.payload.status ?? ''),
		createdAt:
			(previous && 'createdAt' in previous ? previous.createdAt : undefined) ?? event.createdAt
	} as WorkspaceTimelineItem;
	if (index < 0) return [...timeline, item];
	const next = [...timeline];
	next[index] = item;
	return next;
}

export function applyTimelineEvents(
	state: { cursor: number; timeline: WorkspaceTimelineItem[] },
	events: WorkspaceSessionEvent[]
): { cursor: number; timeline: WorkspaceTimelineItem[] } {
	let cursor = state.cursor;
	let timeline = [...state.timeline];
	for (const event of events) {
		if (event.sequence <= cursor) continue;
		cursor = event.sequence;
		timeline = applyTimelineEvent(timeline, event);
	}
	return { cursor, timeline };
}

export function timelineFromSession(
	transcript: WorkspaceTranscriptMessage[],
	messages: Array<{ id: string; text: string; images?: ImageAttachment[]; status: string }>,
	events: WorkspaceSessionEvent[]
): WorkspaceTimelineItem[] {
	const userTurns = transcript
		.map((message, index) => ({ message, index }))
		.filter(({ message }) => message.role === 'user');
	let firstStoredIndex = -1;
	if (messages.length) {
		for (let start = 0; start <= userTurns.length - messages.length; start += 1) {
			if (
				messages.every((message, offset) => userTurns[start + offset].message.text === message.text)
			) {
				firstStoredIndex = userTurns[start].index;
			}
		}
	}
	const historical = firstStoredIndex < 0 ? transcript : transcript.slice(0, firstStoredIndex);
	let timeline: WorkspaceTimelineItem[] = historical.map((message, index) => ({
		...message,
		sequence: index - historical.length,
		kind: 'message'
	}));
	const byId = new Map(messages.map((message) => [message.id, message]));
	for (const event of events) {
		if (event.type === 'message.accepted') {
			const messageId = String(event.payload.messageId ?? '');
			const message = byId.get(messageId);
			if (message) {
				timeline.push({
					sequence: event.sequence,
					kind: 'message',
					role: 'user',
					messageId,
					text: message.text,
					...(message.images?.length ? { images: message.images } : {})
				});
			}
			continue;
		}
		timeline = applyTimelineEvent(timeline, event);
	}
	return timeline;
}

export function planFromEvents(events: WorkspaceSessionEvent[]): WorkspacePlanEntry[] {
	return events.reduce(
		(entries, event) =>
			event.type === 'agent.plan' && Array.isArray(event.payload.entries)
				? (event.payload.entries as WorkspacePlanEntry[])
				: entries,
		[] as WorkspacePlanEntry[]
	);
}

function upsertSubagentTree(
	trees: WorkspaceSubagentTree[],
	payload: Record<string, unknown>
): WorkspaceSubagentTree[] {
	const tree = payload as WorkspaceSubagentTree;
	if (!tree.id || !Array.isArray(tree.children)) return trees;
	const index = trees.findIndex(({ id }) => id === tree.id);
	if (index < 0) return [...trees, tree];
	const next = [...trees];
	next[index] = tree;
	return next;
}

export function subagentTreesFromEvents(events: WorkspaceSessionEvent[]): WorkspaceSubagentTree[] {
	return events.reduce(
		(trees, event) =>
			event.type === 'agent.subagents' ? upsertSubagentTree(trees, event.payload) : trees,
		[] as WorkspaceSubagentTree[]
	);
}

export function applySessionEvents(
	state: WorkspaceDeliveryState,
	events: WorkspaceSessionEvent[]
): WorkspaceDeliveryState {
	let next = {
		...state,
		transcript: [...state.transcript],
		subagents: [...(state.subagents ?? [])],
		activity: [...(state.activity ?? [])],
		plan: [...(state.plan ?? [])]
	};
	for (const event of events) {
		if (event.sequence <= next.cursor) continue;
		next.cursor = event.sequence;
		if (event.payload.messageId !== next.activeMessageId) continue;
		if (event.type === 'message.running') next.delivery = 'running';
		if (event.type === 'agent.chunk') {
			next.pendingAssistant += String(event.payload.text ?? '');
		}
		if (event.type === 'agent.image') {
			next.pendingImages = [...(next.pendingImages ?? []), event.payload.image as ImageAttachment];
		}
		if (event.type === 'agent.thought') {
			next.pendingThought = (next.pendingThought ?? '') + String(event.payload.text ?? '');
		}
		if (event.type === 'agent.subagents') {
			next.subagents = upsertSubagentTree(next.subagents, event.payload);
		}
		next.activity = upsertActivity(next.activity, event);
		if (event.type === 'agent.plan' && Array.isArray(event.payload.entries)) {
			next.plan = event.payload.entries as WorkspacePlanEntry[];
		}
		if (['message.completed', 'message.failed', 'message.unknown'].includes(event.type)) {
			next.delivery =
				event.type === 'message.completed'
					? 'completed'
					: event.type === 'message.failed'
						? 'failed'
						: 'delivery unknown';
			if (next.pendingAssistant || next.pendingImages?.length) {
				next.transcript.push({
					role: 'assistant',
					text: next.pendingAssistant,
					...(next.pendingImages?.length ? { images: next.pendingImages } : {})
				});
			}
			next.pendingAssistant = '';
			next.pendingImages = [];
			next.pendingThought = '';
		}
	}
	return next;
}

export function runSingleFlight(
	holder: { current: Promise<void> | null },
	task: () => Promise<void>
): Promise<void> {
	if (holder.current) return holder.current;
	const pending = task();
	holder.current = pending;
	const clear = () => {
		if (holder.current === pending) holder.current = null;
	};
	void pending.then(clear, clear);
	return pending;
}

export function isCurrentSessionRequest(
	request: { generation: number; projectId: string; sessionId: string },
	current: { generation: number; projectId: string; sessionId: string }
): boolean {
	return (
		request.generation === current.generation &&
		request.projectId === current.projectId &&
		request.sessionId === current.sessionId
	);
}

export function isCurrentTabRequest(
	request: { generation: number; projectId: string; tab: string },
	current: { generation: number; projectId: string; tab: string }
): boolean {
	return (
		request.generation === current.generation &&
		request.projectId === current.projectId &&
		request.tab === current.tab
	);
}

export function isTurnBusy(delivery: string): boolean {
	return ['saving', 'accepted', 'running', 'reconnecting'].includes(delivery);
}

export function formatElapsed(startedAt: string, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
