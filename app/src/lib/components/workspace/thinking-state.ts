import type { WorkspaceTimelineItem } from '$lib';

function skillName(item: WorkspaceTimelineItem) {
	if (item.kind !== 'tool' || item.name !== 'skill_view' || item.status === 'failed') return;
	if (!item.args || typeof item.args !== 'object') return;
	const name = (item.args as Record<string, unknown>).name;
	return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

export function skillsUsed(timeline: WorkspaceTimelineItem[], messageId?: string) {
	if (!messageId) return [];
	return [
		...new Set(
			timeline.flatMap((item) => {
				const name =
					'messageId' in item && item.messageId === messageId ? skillName(item) : undefined;
				return name ? [name] : [];
			})
		)
	];
}

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

export function activeTurnStatus(timeline: WorkspaceTimelineItem[], busy: boolean) {
	if (!busy) return undefined;
	const user = timeline.findLast((item) => item.kind === 'message' && item.role === 'user');
	if (!user || user.kind !== 'message') return 'Thinking';
	const activity = timeline.findLast(
		(item) =>
			['thought', 'tool', 'subagents', 'plan'].includes(item.kind) &&
			(user.messageId
				? 'messageId' in item && item.messageId === user.messageId
				: item.sequence > user.sequence)
	);
	if (!activity || activity.kind === 'thought') return 'Thinking';
	if (activity.kind === 'plan') return 'Planning';
	if (activity.kind !== 'tool' && activity.kind !== 'subagents') return 'Thinking';
	const skill = skillName(activity);
	if (skill) return `Using skill: ${skill} · ${activity.status.replaceAll('_', ' ')}`;
	const title = activity.title ?? (activity.kind === 'tool' ? activity.name : undefined);
	return title
		? `${title} · ${activity.status.replaceAll('_', ' ')}`
		: activity.status.replaceAll('_', ' ');
}
