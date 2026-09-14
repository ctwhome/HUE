import type { ImageAttachment, InputAttachment, ReviewContext } from './message-content';

export type WorkspaceTranscriptMessage = {
	harnessMessageId?: string;
	role: 'user' | 'assistant';
	text: string;
	images?: ImageAttachment[];
	attachments?: InputAttachment[];
	reviewContexts?: ReviewContext[];
	createdAt?: string;
	modelId?: string;
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
	toolCall?: { name?: string; title?: string; kind?: string; args?: unknown };
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
			createdAt?: string;
	  }
	| {
			sequence: number;
			kind: 'status';
			statusType: 'work-mode' | 'failure' | 'unknown';
			messageId?: string;
			label: string;
			createdAt?: string;
	  }
	| { sequence: number; kind: 'thought'; messageId?: string; text: string; createdAt?: string };
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

export function isHarnessMessage(item: WorkspaceTimelineItem): boolean {
	return item.kind === 'message' && !item.messageId;
}

export function mergeHarnessHistory(
	previous: WorkspaceTranscriptMessage[], incoming: WorkspaceTranscriptMessage[],
	previousComplete: boolean, incomingComplete: boolean
): { messages: WorkspaceTranscriptMessage[]; complete: boolean } {
	if (incomingComplete) return { messages: incoming, complete: true };
	if (!incoming.length) return { messages: previous, complete: previousComplete };
	const key = (message: WorkspaceTranscriptMessage) => message.harnessMessageId
		? `id:${message.harnessMessageId}`
		: JSON.stringify([message.role, message.text, message.createdAt, message.images]);
	const oldKeys = previous.map(key);
	const newKeys = incoming.map(key);
	// Recent pages overlap the cached suffix. No overlap means coverage has a gap, not a complete history.
	for (let overlap = Math.min(previous.length, incoming.length); overlap > 0; overlap--) {
		if (newKeys.slice(0, overlap).every((id, index) => id === oldKeys[oldKeys.length - overlap + index]))
			return { messages: [...previous.slice(0, previous.length - overlap), ...incoming], complete: previousComplete };
	}
	return { messages: [...previous, ...incoming], complete: false };
}

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
	const index = activity.findIndex(
		(candidate) =>
			candidate.kind === kind && candidate.id === id && candidate.messageId === item.messageId
	);
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
	if (event.type === 'message.failed' || event.type === 'message.unknown') {
		return [
			...timeline,
			{
				sequence: event.sequence,
				kind: 'status',
				messageId,
				statusType: event.type === 'message.failed' ? 'failure' : 'unknown',
				label: `${event.type === 'message.failed' ? 'Message failed' : 'Delivery unconfirmed'}: ${String(event.payload.error ?? 'No further details available')}`,
				createdAt: event.createdAt
			}
		];
	}
	if (event.type === 'message.accepted') {
		const index = timeline.findIndex(
			(item) => item.kind === 'message' && item.role === 'user' && item.messageId === messageId
		);
		if (index < 0) return timeline;
		const next = [...timeline];
		next[index] = {
			...next[index],
			sequence: event.sequence,
			createdAt: next[index].createdAt ?? event.createdAt
		} as WorkspaceTimelineItem;
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
				...(event.payload.modelId ? { modelId: String(event.payload.modelId) } : {}),
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
				...(event.payload.modelId ? { modelId: String(event.payload.modelId) } : {}),
				...(event.createdAt ? { createdAt: event.createdAt } : {}),
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
				text: String(event.payload.text ?? ''),
				...(event.createdAt ? { createdAt: event.createdAt } : {})
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
			entries: event.payload.entries as WorkspacePlanEntry[],
			createdAt: index < 0 ? event.createdAt : timeline[index].createdAt
		};
		if (index < 0) return [...timeline, item];
		const next = [...timeline];
		next[index] = item;
		return next;
	}
	if (event.type === 'session.work_mode_changed') {
		const workMode = String(event.payload.workMode ?? '');
		const label =
			workMode === 'live' ? 'Work mode changed to Live' : 'Work mode changed to Autonomous';
		return [
			...timeline,
			{
				sequence: event.sequence,
				kind: 'status',
				statusType: 'work-mode',
				label,
				...(event.createdAt ? { createdAt: event.createdAt } : {})
			}
		];
	}
	const kind = ACTIVITY_TYPES.get(event.type as never);
	const id = String(event.payload.id ?? '');
	if (!kind || !id) return timeline;
	const index = timeline.findIndex(
		(item) => item.kind === kind && 'id' in item && item.id === id && item.messageId === messageId
	);
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
	if (events.every((event) => event.sequence <= state.cursor)) return state;
	let cursor = state.cursor;
	let timeline = state.timeline;
	const sequences = new Set(state.timeline.map((item) => item.sequence));
	for (const event of events) {
		if (event.sequence <= cursor) continue;
		cursor = event.sequence;
		if (!sequences.has(event.sequence)) {
			timeline = applyTimelineEvent(timeline, event);
		}
	}
	return { cursor, timeline };
}

export function timelineFromSession(
	transcript: WorkspaceTranscriptMessage[],
	messages: Array<{
		id: string;
		text: string;
		images?: ImageAttachment[];
		attachments?: InputAttachment[];
		reviewContexts?: ReviewContext[];
		status: string;
		createdAt?: string;
	}>,
	events: WorkspaceSessionEvent[]
): WorkspaceTimelineItem[] {
	const deliveredEvents = new Set(
		events.flatMap((event) =>
			(event.type === 'message.running' ||
				event.type === 'message.completed' ||
				event.type.startsWith('agent.')) &&
			typeof event.payload.messageId === 'string'
				? [event.payload.messageId]
				: []
		)
	);
	const deliveredMessages = messages.filter(
		(message) =>
			['running', 'completed', 'cancelled', 'failed', 'unknown'].includes(message.status) &&
			deliveredEvents.has(message.id)
	);
	let timeline: WorkspaceTimelineItem[] = [];
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
					createdAt: message.createdAt ?? event.createdAt,
					...(message.images?.length ? { images: message.images } : {}),
					...(message.attachments?.length ? { attachments: message.attachments } : {}),
					...(message.reviewContexts?.length ? { reviewContexts: message.reviewContexts } : {})
				});
			}
			continue;
		}
		timeline = applyTimelineEvent(timeline, event);
	}
	return reconcileTimelineHistory(transcript, timeline, deliveredMessages);
}

export function reconcileTimelineHistory(
	transcript: WorkspaceTranscriptMessage[], timeline: WorkspaceTimelineItem[],
	messages: Array<{ id: string; text: string; status: string }>
): WorkspaceTimelineItem[] {
	const deliveredMessages = messages.filter((message) => ['running', 'completed', 'cancelled', 'failed', 'unknown'].includes(message.status));
	const userTurns = transcript.map((message, index) => ({ message, index })).filter(({ message }) => message.role === 'user');
	let matchedStart = -1;
	let matchedCount = 0;
	let bestScore = -1;
	const localAnswers = new Map<string, string>();
	for (const item of timeline) if (item.kind === 'message' && item.role === 'assistant' && item.messageId)
		localAnswers.set(item.messageId, (localAnswers.get(item.messageId) ?? '') + item.text);
	const harnessAnswers = userTurns.map((turn, index) => transcript.slice(turn.index + 1, userTurns[index + 1]?.index ?? transcript.length).map((message) => message.text).join('').trim());
	for (let count = Math.min(userTurns.length, deliveredMessages.length); count > 0 && matchedStart < 0; count--) {
		for (let start = 0; start <= userTurns.length - count; start++) {
			if (deliveredMessages.slice(0, count).every((message, offset) => userTurns[start + offset].message.text.trim() === message.text.trim())) {
				const score = deliveredMessages.slice(0, count).reduce((score, message, offset) =>
					score + Number(Boolean(localAnswers.get(message.id)?.trim()) && localAnswers.get(message.id)!.trim() === harnessAnswers[start + offset]), 0);
				if (score < bestScore) continue;
				bestScore = score;
				matchedStart = start;
				matchedCount = count;
			}
		}
	}
	// Replace only matched turns, never the entire harness suffix: it can contain external work.
	const matches: Array<{ start: number; end: number; id: string; status: string }> = [];
	let nextTurn = 0;
	for (let index = 0; index < deliveredMessages.length; index++) {
		const message = deliveredMessages[index];
		const turn = index < matchedCount ? matchedStart + index
			: userTurns.findIndex((entry, candidate) => candidate >= nextTurn && entry.message.text.trim() === message.text.trim());
		if (turn < 0 || !timeline.some((item) => item.kind === 'message' && item.role === 'user' && item.messageId === message.id)) continue;
		nextTurn = turn + 1;
		matches.push({ start: userTurns[turn].index, end: userTurns[turn + 1]?.index ?? transcript.length, id: message.id, status: message.status });
	}
	const recovered = new Set<string>();
	for (const match of matches) {
		const harness = transcript.slice(match.start + 1, match.end);
		const local = timeline.filter((item) => item.kind === 'message' && item.role === 'assistant' && item.messageId === match.id);
		const text = (items: WorkspaceTranscriptMessage[]) => items.map((item) => item.text).join('').trim();
		const images = (items: WorkspaceTranscriptMessage[]) => JSON.stringify(items.flatMap((item) => item.images ?? []).map(({ mimeType, data }) => [mimeType, data]));
		if (match.status !== 'running' && harness.length &&
			(text(harness) !== text(local as WorkspaceTranscriptMessage[]) || images(harness) !== images(local as WorkspaceTranscriptMessage[]))) recovered.add(match.id);
	}
	timeline = timeline.filter((item) => !(item.kind === 'message' && item.role === 'assistant' && item.messageId && recovered.has(item.messageId)));
	const insertions = new Map<number, WorkspaceTranscriptMessage[]>();
	const insert = (index: number, items: WorkspaceTranscriptMessage[]) =>
		insertions.set(index, [...(insertions.get(index) ?? []), ...items]);
	let cursor = 0;
	let lastPosition = 0;
	for (const match of matches) {
		const first = timeline.findIndex((item) => 'messageId' in item && item.messageId === match.id);
		const last = timeline.findLastIndex((item) => 'messageId' in item && item.messageId === match.id) + 1;
		insert(first, transcript.slice(cursor, match.start));
		if (recovered.has(match.id)) insert(last, transcript.slice(match.start + 1, match.end));
		cursor = match.end;
		lastPosition = last;
	}
	insert(lastPosition, transcript.slice(cursor));
	const result: WorkspaceTimelineItem[] = [];
	for (let index = 0; index <= timeline.length; index++) {
		const items = insertions.get(index) ?? [];
		const left = timeline[index - 1]?.sequence ?? -items.length - 1;
		const right = timeline[index]?.sequence ?? left + 1;
		result.push(...items.map((message, offset): WorkspaceTimelineItem => ({
			...message, kind: 'message',
			sequence: index === 0 ? offset - items.length : left + (right - left) * (offset + 1) / (items.length + 1)
		})));
		if (timeline[index]) result.push(timeline[index]);
	}
	return result;
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
	const index = trees.findIndex(
		({ id, messageId }) => id === tree.id && messageId === tree.messageId
	);
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
		transcript: state.transcript,
		subagents: state.subagents ?? [],
		activity: state.activity ?? [],
		plan: state.plan ?? []
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
		if (
			['message.completed', 'message.failed', 'message.unknown', 'message.cancelled'].includes(
				event.type
			)
		) {
			next.delivery =
				event.type === 'message.completed'
					? 'completed'
					: event.type === 'message.failed'
						? 'failed'
						: event.type === 'message.cancelled'
							? 'cancelled'
							: 'delivery unknown';
			if (next.pendingAssistant || next.pendingImages?.length) {
				next.transcript = [
					...next.transcript,
					{
						role: 'assistant',
						text: next.pendingAssistant,
						...(next.pendingImages?.length ? { images: next.pendingImages } : {})
					}
				];
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
	return ['saving', 'accepted', 'running', 'reconnecting', 'cancelling'].includes(delivery);
}

export function formatElapsed(startedAt: string, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
