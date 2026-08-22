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
};
export type WorkspaceDeliveryState = {
	cursor: number;
	activeMessageId: string;
	pendingAssistant: string;
	pendingImages?: ImageAttachment[];
	pendingThought?: string;
	delivery: string;
	transcript: WorkspaceTranscriptMessage[];
	subagents?: WorkspaceSubagentTree[];
};

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
		subagents: [...(state.subagents ?? [])]
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
