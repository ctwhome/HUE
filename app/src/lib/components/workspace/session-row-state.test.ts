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

test('session status is a compact icon badge instead of consuming title width', () => {
	const panel = readFileSync(new URL('./ContextPanel.svelte', import.meta.url), 'utf8');
	expect(panel).toContain('session-state-badge');
	expect(panel).toContain("aria-label={`${session.title || 'Untitled session'}, ${state.label}`}");
	expect(panel).not.toContain('class="session-state shrink-0"');
});

test('session rows reserve action space only when actions are visible', () => {
	const panel = readFileSync(new URL('./ContextPanel.svelte', import.meta.url), 'utf8');
	const forms = readFileSync(
		new URL('../../../styles/workspace-forms.css', import.meta.url),
		'utf8'
	);
	const responsive = readFileSync(
		new URL('../../../styles/responsive.css', import.meta.url),
		'utf8'
	);
	expect(panel).toContain('py-1 pr-2 pl-8');
	expect(forms).toContain('.session-row:hover .session-select');
	expect(forms).toContain('padding-right: 4rem');
	expect(responsive).toContain('.session-select.active {\n\t\tpadding-right: 88px;');
	expect(responsive).toMatch(/\.session-edit,\s*\.session-archive\s*\{[^}]*opacity: 0;/);
});

test('hidden archived sessions use an explicit crossed archive icon', () => {
	const panel = readFileSync(new URL('./ContextPanel.svelte', import.meta.url), 'utf8');
	expect(panel).toContain("import ArchiveX from '~icons/lucide/archive-x';");
	expect(panel).toContain('<ArchiveX width={17} height={17} aria-hidden="true" />');
});
