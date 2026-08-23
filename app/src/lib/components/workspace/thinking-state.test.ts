import { describe, expect, it } from 'bun:test';
import type { WorkspaceTimelineItem } from '$lib';
import { activeThought } from './thinking-state';

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
