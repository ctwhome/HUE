import { describe, expect, it } from 'bun:test';
import {
	DEFAULT_WORK_MODE,
	buildWorkModePreamble,
	detectWorkModeSwitch,
	formatWorkModeAnnouncement,
	parseWorkMode,
	stripHermesPreamble,
	type WorkMode
} from './work-mode';

describe('work-mode parser', () => {
	it('parses supported enum values only', () => {
		expect(parseWorkMode('autonomous')).toBe('autonomous');
		expect(parseWorkMode('live')).toBe('live');
		expect(parseWorkMode('AUTO')).toBeNull();
	});

	it('defaults new work mode to autonomous', () => {
		expect(DEFAULT_WORK_MODE).toBe('autonomous');
	});

	it('detects exact slash aliases without fuzzy matching', () => {
		expect(detectWorkModeSwitch('/live-co-development')).toEqual({
			workMode: 'live',
			consumed: true,
			source: 'slash'
		});
		expect(detectWorkModeSwitch('/autonomous-delivery')).toEqual({
			workMode: 'autonomous',
			consumed: true,
			source: 'slash'
		});
		expect(detectWorkModeSwitch('/work-mode live')).toEqual({
			workMode: 'live',
			consumed: true,
			source: 'slash'
		});
	});

	it('detects anchored natural-language live and autonomous phrases only', () => {
		const cases: Array<[string, WorkMode]> = [
			["I'm at the computer", 'live'],
			["Okay, I'm at the computer now. Let's work together on the composer.", 'live'],
			['okay I am at the computer', 'live'],
			["let's work together", 'live'],
			['the dev server is running', 'live'],
			['continue autonomously', 'autonomous'],
			["Continue autonomously; I'm leaving now.", 'autonomous'],
			['finish autonomously', 'autonomous'],
			['I am leaving', 'autonomous'],
			["I'm leaving", 'autonomous']
		];
		for (const [text, workMode] of cases) {
			expect(detectWorkModeSwitch(text)).toMatchObject({
				workMode,
				consumed: false,
				source: 'natural'
			});
		}
	});

	it('ignores incidental mentions, quotes, and code fences', () => {
		for (const text of [
			'Docs say "I am at the computer" should switch modes.',
			'If the dev server is running, keep checking logs.',
			'```txt\nI am leaving\n```',
			'`/work-mode live`',
			'Here is /live-co-development in docs'
		]) {
			expect(detectWorkModeSwitch(text)).toBeNull();
		}
	});

	it('formats polite selector announcements', () => {
		expect(formatWorkModeAnnouncement('live')).toContain('Live');
		expect(formatWorkModeAnnouncement('autonomous')).toContain('Autonomous');
	});

	it('tells Hermes how to attach generated files to HUE', () => {
		const preamble = buildWorkModePreamble('autonomous');
		expect(preamble).toContain('save it inside the Session working directory');
		expect(preamble).toContain('MEDIA: relative/path');
	});

	it('strips only exact generated Hermes preamble', () => {
		const body = stripHermesPreamble(`${buildWorkModePreamble('live')}\nShip it`);
		expect(body).toBe('Ship it');
		expect(
			stripHermesPreamble('HUE Work mode: Live.\nThis looks similar but lacks exact envelope.')
		).toBe('HUE Work mode: Live.\nThis looks similar but lacks exact envelope.');
	});
});
