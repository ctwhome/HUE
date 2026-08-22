import { describe, expect, it } from 'bun:test';
import { normalizePreferences, shouldSendMessage } from './preferences';

describe('HUE preferences', () => {
	it('accepts supported appearance, composer, language, voice, and visibility values', () => {
		expect(
			normalizePreferences({
				sendKey: 'mod-enter',
				theme: 'oled',
				density: 'compact',
				language: 'nl-NL',
				voice: 'system',
				showUsage: false,
				showCliSessions: false
			})
		).toEqual({
			sendKey: 'mod-enter',
			theme: 'oled',
			density: 'compact',
			language: 'nl-NL',
			voice: 'system',
			showUsage: false
		});
	});

	it('falls back safely for malformed persisted preferences', () => {
		expect(normalizePreferences({ theme: 'secret-theme', showUsage: 'yes' })).toEqual({
			sendKey: 'enter',
			theme: 'system',
			density: 'comfortable',
			language: 'en',
			voice: 'hermes',
			showUsage: true
		});
	});

	it('applies Enter or modifier+Enter send behavior without stealing Shift+Enter', () => {
		expect(
			shouldSendMessage({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false }, 'enter')
		).toBe(true);
		expect(
			shouldSendMessage({ key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false }, 'enter')
		).toBe(false);
		expect(
			shouldSendMessage(
				{ key: 'Enter', shiftKey: false, metaKey: true, ctrlKey: false },
				'mod-enter'
			)
		).toBe(true);
		expect(
			shouldSendMessage(
				{ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false },
				'mod-enter'
			)
		).toBe(false);
	});
});
