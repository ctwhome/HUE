import { describe, expect, it } from 'bun:test';
import type { WorkspaceTimelineItem } from '$lib';
import { activeThought, activeTurnStatus, skillsUsed } from './thinking-state';

const timeline = (items: WorkspaceTimelineItem[]) => items;

describe('activeThought', () => {
	it('selects only reasoning belonging to the latest busy user turn', () => {
		const items = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'old', text: 'Earlier' },
			{ sequence: 2, kind: 'thought', messageId: 'old', text: 'Historical reasoning' },
			{ sequence: 3, kind: 'message', role: 'assistant', messageId: 'old', text: 'Done' },
			{ sequence: 4, kind: 'message', role: 'user', messageId: 'current', text: 'Now' },
			{ sequence: 5, kind: 'thought', messageId: 'current', text: 'Active reasoning' }
		]);

		expect(activeThought(items, true)?.sequence).toBe(5);
	});

	it('matches current reasoning while the user message still has an optimistic sequence', () => {
		const items = timeline([
			{ sequence: 100, kind: 'message', role: 'user', messageId: 'current', text: 'Now' },
			{ sequence: 2, kind: 'thought', messageId: 'current', text: 'Active reasoning' }
		]);

		expect(activeThought(items, true)?.sequence).toBe(2);
	});

	it('does not reactivate historical reasoning before a new thought arrives', () => {
		const items = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'old', text: 'Earlier' },
			{ sequence: 2, kind: 'thought', messageId: 'old', text: 'Historical reasoning' },
			{ sequence: 3, kind: 'message', role: 'user', messageId: 'current', text: 'Now' }
		]);

		expect(activeThought(items, true)).toBeUndefined();
	});

	it('does not match an older unscoped thought to an unscoped current turn', () => {
		const items = timeline([
			{ sequence: 1, kind: 'thought', text: 'Historical reasoning' },
			{ sequence: 2, kind: 'message', role: 'user', text: 'Now' }
		]);

		expect(activeThought(items, true)).toBeUndefined();
	});

	it('keeps every thought inactive after the turn finishes', () => {
		const items = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'current', text: 'Now' },
			{ sequence: 2, kind: 'thought', messageId: 'current', text: 'Finished reasoning' }
		]);

		expect(activeThought(items, false)).toBeUndefined();
	});
});

describe('activeTurnStatus', () => {
	it('starts with Thinking and follows the latest published action for the current turn', () => {
		const current = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'old', text: 'Earlier' },
			{
				sequence: 2,
				kind: 'tool',
				messageId: 'old',
				id: 'old-tool',
				status: 'completed',
				title: 'Old action'
			},
			{ sequence: 3, kind: 'message', role: 'user', messageId: 'current', text: 'Now' }
		]);

		expect(activeTurnStatus(current, true)).toBe('Thinking');
		expect(
			activeTurnStatus(
				[
					...current,
					{
						sequence: 4,
						kind: 'tool',
						messageId: 'current',
						id: 'tool-1',
						status: 'in_progress',
						title: 'Searching files'
					}
				],
				true
			)
		).toBe('Searching files · in progress');
	});

	it('uses generic reasoning copy and disappears after completion', () => {
		const items = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'current', text: 'Now' },
			{ sequence: 2, kind: 'thought', messageId: 'current', text: 'Private published reasoning' }
		]);

		expect(activeTurnStatus(items, true)).toBe('Thinking');
		expect(activeTurnStatus(items, false)).toBeUndefined();
	});

	it('names a skill when Hermes publishes a skill_view tool call', () => {
		const items = timeline([
			{ sequence: 1, kind: 'message', role: 'user', messageId: 'current', text: 'Now' },
			{
				sequence: 2,
				kind: 'tool',
				messageId: 'current',
				id: 'skill-1',
				name: 'skill_view',
				title: 'skill view (humanizer)',
				status: 'in_progress',
				args: { name: 'humanizer' }
			}
		]);

		expect(activeTurnStatus(items, true)).toBe('Using skill: humanizer · in progress');
	});
});

describe('skillsUsed', () => {
	it('returns unique successfully loaded skills for one response', () => {
		const items = timeline([
			{
				sequence: 1,
				kind: 'tool',
				messageId: 'current',
				id: 'skill-1',
				name: 'skill_view',
				status: 'completed',
				args: { name: 'humanizer' }
			},
			{
				sequence: 2,
				kind: 'tool',
				messageId: 'other',
				id: 'skill-2',
				name: 'skill_view',
				status: 'completed',
				args: { name: 'unrelated' }
			},
			{
				sequence: 3,
				kind: 'tool',
				messageId: 'current',
				id: 'skill-3',
				name: 'skill_view',
				status: 'failed',
				args: { name: 'failed-skill' }
			}
		]);

		expect(skillsUsed(items, 'current')).toEqual(['humanizer']);
	});
});
