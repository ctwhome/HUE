import type { WorkspacePlanEntry, WorkspaceTimelineItem } from './workspace-state';

export function selectTranscriptTimeline(
	timeline: WorkspaceTimelineItem[]
): WorkspaceTimelineItem[] {
	return timeline.filter(
		(item) =>
			item.kind === 'message' ||
			((item.kind === 'permission' || item.kind === 'clarify') && item.status === 'pending')
	);
}

export function selectThinkingTimeline(timeline: WorkspaceTimelineItem[]): WorkspaceTimelineItem[] {
	return timeline.filter(
		(item) =>
			['thought', 'tool', 'status', 'subagents'].includes(item.kind) ||
			((item.kind === 'permission' || item.kind === 'clarify') && item.status !== 'pending')
	);
}

export function selectLatestPlan(timeline: WorkspaceTimelineItem[]): WorkspacePlanEntry[] {
	return [...timeline].reverse().find((item) => item.kind === 'plan')?.entries ?? [];
}

export function selectSessionArtifacts(timeline: WorkspaceTimelineItem[]): string[] {
	return [
		...new Set(
			timeline.flatMap((item) =>
				item.kind === 'message' && item.role === 'assistant'
					? item.text.split(/\r?\n/).flatMap((line) => line.match(/^MEDIA:\s*(.+?)\s*$/)?.[1] ?? [])
					: []
			)
		)
	];
}

export function selectTaskSummary(plan: WorkspacePlanEntry[]) {
	if (!plan.length) return null;
	return {
		entry:
			plan.find(({ status }) => status === 'in_progress') ??
			plan.find(({ status }) => status === 'pending') ??
			plan.at(-1)!,
		completed: plan.filter(({ status }) => status === 'completed').length,
		total: plan.length
	};
}
