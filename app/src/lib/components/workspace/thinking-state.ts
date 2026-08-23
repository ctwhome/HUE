import type { WorkspaceTimelineItem } from '$lib';

export function activeThought(timeline: WorkspaceTimelineItem[], busy: boolean) {
	if (!busy) return undefined;
	const user = timeline.findLast((item) => item.kind === 'message' && item.role === 'user');
	if (!user || user.kind !== 'message') return undefined;
	return timeline.findLast(
		(item) =>
			item.kind === 'thought' &&
			(user.messageId ? item.messageId === user.messageId : item.sequence > user.sequence)
	) as Extract<WorkspaceTimelineItem, { kind: 'thought' }> | undefined;
}
