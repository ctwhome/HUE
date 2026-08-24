import { describe, expect, it } from 'bun:test';
import { resolveNotificationTarget } from './notification-target';

const events = [
	{
		sequence: 7,
		type: 'agent.permission',
		payload: { id: 'permission-1', messageId: 'message-1', status: 'pending' }
	},
	{
		sequence: 9,
		type: 'message.completed',
		payload: { messageId: 'message-1' }
	}
];

describe('notification transcript targets', () => {
	it('targets an actionable interaction by event with a message fallback', () => {
		expect(resolveNotificationTarget(events, '7')).toEqual({
			sequence: 7,
			messageId: 'message-1',
			actionable: true
		});
	});

	it('targets a terminal outcome by message', () => {
		expect(resolveNotificationTarget(events, '9')).toEqual({
			sequence: 9,
			messageId: 'message-1',
			actionable: false
		});
	});

	it('ignores invalid or unavailable event targets', () => {
		expect(resolveNotificationTarget(events, 'private')).toBeNull();
		expect(resolveNotificationTarget(events, '999')).toBeNull();
	});
});
