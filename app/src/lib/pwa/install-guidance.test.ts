import { expect, test } from 'bun:test';
import { actionFailureStatus, installOfferVisible, pinGuidance } from './install-guidance';

test('install offer requires browser support and honors dismissal', () => {
	expect(installOfferVisible(false, false)).toBe(false);
	expect(installOfferVisible(true, true)).toBe(false);
	expect(installOfferVisible(true, false)).toBe(true);
});

test('platform action errors become accessible non-secret status', () => {
	expect(actionFailureStatus('copy', new DOMException('denied secret', 'NotAllowedError'))).toBe(
		'Could not copy link. Use the browser address bar instead.'
	);
	expect(actionFailureStatus('share', new DOMException('cancelled', 'AbortError'))).toBe(
		'Sharing cancelled.'
	);
	expect(actionFailureStatus('share', new Error('private provider detail'))).toBe(
		'Could not share link. Copy it instead.'
	);
});

test('pin guidance describes honest browser fallbacks without dynamic shortcut claims', () => {
	const guidance = pinGuidance('Project HUE', 'Session 85');
	expect(guidance).toContain('current Session');
	expect(guidance).toContain('copy or share');
	expect(guidance).toContain('browser menu');
	expect(guidance).not.toMatch(/dynamic shortcut|pinned successfully|will pin/i);
});
