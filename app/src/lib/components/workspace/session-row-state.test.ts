import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sessionRowState } from './session-row-state';

test('Session row state preserves authoritative labels and maps them to icons', () => {
	expect(sessionRowState({ busySince: '2026-08-26T10:00:00Z' })).toEqual({
		label: 'Running',
		icon: 'running',
		attention: false
	});
	expect(sessionRowState({ status: 'waiting-permission' })).toEqual({
		label: 'Waiting for permission',
		icon: 'waiting',
		attention: true
	});
	expect(sessionRowState({ status: 'waiting-answer' })).toEqual({
		label: 'Waiting for answer',
		icon: 'waiting',
		attention: true
	});
	expect(sessionRowState({ status: 'unknown' })).toEqual({
		label: 'Interrupted, delivery unknown',
		icon: 'unknown',
		attention: true
	});
	expect(sessionRowState({ status: 'failed' })).toEqual({
		label: 'Failed',
		icon: 'failed',
		attention: true
	});
	expect(sessionRowState({})).toEqual({ label: 'Idle', icon: 'idle', attention: false });
});

test('selected cancellation and unread attention remain explicit text', () => {
	expect(sessionRowState({ delivery: 'cancelling', unreadAttention: true })).toEqual({
		label: 'Cancelling',
		icon: 'running',
		attention: true,
		note: 'Unread attention'
	});
	expect(sessionRowState({ status: 'cancelled' })).toEqual({
		label: 'Cancelled',
		icon: 'cancelled',
		attention: false
	});
});

test('session row icons are larger than navigation icons', () => {
	const panel = readFileSync(new URL('./ContextPanel.svelte', import.meta.url), 'utf8');
	expect(panel).toContain('session-icon session-icon-image size-8');
	expect(panel).toContain('session-icon grid size-8');
});
