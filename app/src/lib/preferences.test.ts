import { describe, expect, it } from 'bun:test';
import {
	isDarkTheme,
	normalizePreferences,
	shouldSendMessage,
	themeChromeColor
} from './preferences';

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
				hiddenFilePatterns: '.DS_Store\r\n*.log',
				showCliSessions: false
			})
		).toEqual({
			sendKey: 'mod-enter',
			theme: 'oled',
			density: 'compact',
			language: 'nl-NL',
			voice: 'system',
			showUsage: false,
			hiddenFilePatterns: '.DS_Store\n*.log'
		});
	});

	it('falls back safely for malformed persisted preferences', () => {
		expect(normalizePreferences({ theme: 'secret-theme', showUsage: 'yes' })).toEqual({
			sendKey: 'enter',
			theme: 'system',
			density: 'comfortable',
			language: 'en',
			voice: 'hermes',
			showUsage: true,
			hiddenFilePatterns: '.DS_Store'
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

	it('maps appearance preferences to coordinated browser chrome colors', () => {
		expect(themeChromeColor('dark', false)).toBe('#050505');
		expect(themeChromeColor('oled', false)).toBe('#000000');
		expect(themeChromeColor('light', true)).toBe('#f3f3f3');
		expect(themeChromeColor('system', true)).toBe('#050505');
		expect(themeChromeColor('system', false)).toBe('#f3f3f3');
	});

	it('accepts additional light and dark themes', () => {
		for (const theme of ['github-light', 'solarized-light', 'tokyo-night', 'nord'] as const) {
			expect(normalizePreferences({ theme }).theme).toBe(theme);
		}
	});

	it('classifies additional themes for browser and embedded surfaces', () => {
		expect(isDarkTheme('tokyo-night', false)).toBe(true);
		expect(isDarkTheme('nord', false)).toBe(true);
		expect(isDarkTheme('github-light', true)).toBe(false);
		expect(isDarkTheme('solarized-light', true)).toBe(false);
		expect(themeChromeColor('tokyo-night', false)).toBe('#16161e');
		expect(themeChromeColor('nord', false)).toBe('#2e3440');
		expect(themeChromeColor('github-light', true)).toBe('#f6f8fa');
		expect(themeChromeColor('solarized-light', true)).toBe('#eee8d5');
	});
});
