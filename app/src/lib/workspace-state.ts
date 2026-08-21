export type WorkspaceTranscriptMessage = { role: 'user' | 'assistant'; text: string };
export type WorkspaceSessionEvent = {
	sequence: number;
	type: string;
	payload: Record<string, unknown>;
};
export type WorkspaceDeliveryState = {
	cursor: number;
	activeMessageId: string;
	pendingAssistant: string;
	delivery: string;
	transcript: WorkspaceTranscriptMessage[];
};

export function applySessionEvents(
	state: WorkspaceDeliveryState,
	events: WorkspaceSessionEvent[]
): WorkspaceDeliveryState {
	let next = { ...state, transcript: [...state.transcript] };
	for (const event of events) {
		if (event.sequence <= next.cursor) continue;
		next.cursor = event.sequence;
		if (event.payload.messageId !== next.activeMessageId) continue;
		if (event.type === 'message.running') next.delivery = 'running';
		if (event.type === 'agent.chunk') {
			next.pendingAssistant += String(event.payload.text ?? '');
		}
		if (['message.completed', 'message.failed', 'message.unknown'].includes(event.type)) {
			next.delivery =
				event.type === 'message.completed'
					? 'completed'
					: event.type === 'message.failed'
						? 'failed'
						: 'delivery unknown';
			if (next.pendingAssistant) {
				next.transcript.push({ role: 'assistant', text: next.pendingAssistant });
			}
			next.pendingAssistant = '';
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
