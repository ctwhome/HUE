import type { SessionEvent } from './types';

export type NotificationTarget = {
	sequence: number;
	messageId: string | null;
	actionable: boolean;
};

export function resolveNotificationTarget(
	events: SessionEvent[],
	sourceEventId: string | null
): NotificationTarget | null {
	if (!sourceEventId || !/^\d+$/.test(sourceEventId)) return null;
	const sequence = Number(sourceEventId);
	const event = events.find((candidate) => candidate.sequence === sequence);
	if (!event) return null;
	return {
		sequence,
		messageId: typeof event.payload.messageId === 'string' ? event.payload.messageId : null,
		actionable: event.type === 'agent.permission' || event.type === 'agent.clarify'
	};
}
