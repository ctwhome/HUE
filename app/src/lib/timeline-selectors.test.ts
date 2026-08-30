import { describe, expect, it } from 'bun:test';
import {
	selectLatestPlan,
	selectSessionArtifacts,
	selectTaskSummary,
	selectThinkingTimeline,
	selectTranscriptTimeline
} from './timeline-selectors';
import type { WorkspaceTimelineItem } from './workspace-state';

describe('timeline selectors', () => {
	it('keeps clean transcript and thinking activity in source order while selecting latest plan', () => {
		const timeline: WorkspaceTimelineItem[] = [
			{ sequence: 1, kind: 'message', role: 'user', text: 'Start' },
			{ sequence: 2, kind: 'thought', text: 'Inspecting' },
			{ sequence: 3, kind: 'tool', id: 'tool-1', status: 'completed', title: 'Read' },
			{
				sequence: 4,
				kind: 'plan',
				entries: [{ content: 'Old task', priority: 'high', status: 'completed' }]
			},
			{ sequence: 5, kind: 'permission', id: 'permission-1', status: 'pending' },
			{ sequence: 6, kind: 'clarify', id: 'clarify-1', status: 'resolved' },
			{ sequence: 7, kind: 'status', statusType: 'work-mode', label: 'Live' },
			{
				sequence: 8,
				kind: 'subagents',
				id: 'agents-1',
				status: 'completed',
				children: []
			},
			{ sequence: 9, kind: 'message', role: 'assistant', text: 'Done' },
			{
				sequence: 10,
				kind: 'plan',
				entries: [
					{ content: 'Current task', priority: 'high', status: 'in_progress' },
					{ content: 'Later task', priority: 'medium', status: 'pending' }
				]
			}
		];

		expect(selectTranscriptTimeline(timeline).map(({ sequence }) => sequence)).toEqual([1, 5, 9]);
		expect(selectThinkingTimeline(timeline).map(({ sequence }) => sequence)).toEqual([
			2, 3, 6, 7, 8
		]);
		expect(selectLatestPlan(timeline)).toEqual([
			{ content: 'Current task', priority: 'high', status: 'in_progress' },
			{ content: 'Later task', priority: 'medium', status: 'pending' }
		]);
	});

	it('chooses in-progress, pending, then latest task fallback with progress', () => {
		const complete = { content: 'Inspect', priority: 'high', status: 'completed' };
		const pending = { content: 'Test', priority: 'medium', status: 'pending' };
		const active = { content: 'Build', priority: 'high', status: 'in_progress' };

		expect(selectTaskSummary([complete, pending, active])).toEqual({
			entry: active,
			completed: 1,
			total: 3
		});
		expect(selectTaskSummary([complete, pending])?.entry).toEqual(pending);
		expect(selectTaskSummary([complete])?.entry).toEqual(complete);
		expect(selectTaskSummary([])).toBeNull();
	});

	it('selects unique Hermes MEDIA artifacts from assistant messages in transcript order', () => {
		const timeline: WorkspaceTimelineItem[] = [
			{ sequence: 1, kind: 'message', role: 'user', text: 'MEDIA: input.png' },
			{
				sequence: 2,
				kind: 'message',
				role: 'assistant',
				text: 'Created these files:\nMEDIA: output/render.png\nMEDIA: output/report.pdf'
			},
			{
				sequence: 3,
				kind: 'message',
				role: 'assistant',
				text: 'MEDIA: output/render.png'
			}
		];

		expect(selectSessionArtifacts(timeline)).toEqual(['output/render.png', 'output/report.pdf']);
	});
});
