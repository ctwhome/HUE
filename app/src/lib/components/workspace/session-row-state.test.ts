import { expect, test } from 'bun:test';
import { sessionRowState } from './session-row-state';

test('Session row state preserves authoritative running, waiting, interruption, failure, and quiet labels', () => {
	expect(sessionRowState({ busySince: '2026-08-26T10:00:00Z' })).toEqual({
		label: 'Running',
		attention: false
	});
	expect(sessionRowState({ status: 'waiting-permission' })).toEqual({
		label: 'Waiting for permission',
		attention: true
	});
	expect(sessionRowState({ status: 'waiting-answer' })).toEqual({
		label: 'Waiting for answer',
		attention: true
	});
	expect(sessionRowState({ status: 'unknown' })).toEqual({
		label: 'Interrupted, delivery unknown',
		attention: true
	});
	expect(sessionRowState({ status: 'failed' })).toEqual({ label: 'Failed', attention: true });
	expect(sessionRowState({})).toEqual({ label: 'Quiet', attention: false });
});

test('selected cancellation and unread attention remain explicit text', () => {
	expect(sessionRowState({ delivery: 'cancelling', unreadAttention: true })).toEqual({
		label: 'Cancelling',
		attention: true,
		note: 'Unread attention'
	});
});
