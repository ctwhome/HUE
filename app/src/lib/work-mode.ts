export type WorkMode = 'autonomous' | 'live';
export type WorkModeSwitch = {
	workMode: WorkMode;
	consumed: boolean;
	source: 'slash' | 'natural';
};

export const DEFAULT_WORK_MODE: WorkMode = 'autonomous';
export const WORK_MODE_VERSION = 1;

const NATURAL_PATTERNS: Array<{ workMode: WorkMode; pattern: RegExp }> = [
	{
		workMode: 'live',
		pattern:
			/^(?:ok(?:ay)?[,.!]?\s+)?(?:i['’]?m at (?:the|my) computer(?: now)?|i am at (?:the|my) computer(?: now)?|let['’]?s work together|the dev server is running)(?:[,.!?:;—-]|\s|$)/i
	},
	{
		workMode: 'autonomous',
		pattern:
			/^(?:ok(?:ay)?[,.!]?\s+)?(?:continue autonomously|finish autonomously|i am leaving(?: now)?|i['’]?m leaving(?: now)?)(?:[,.!?:;—-]|\s|$)/i
	}
];

export function parseWorkMode(value: unknown): WorkMode | null {
	return value === 'autonomous' || value === 'live' ? value : null;
}

export function workModeLabel(workMode: WorkMode): 'Autonomous' | 'Live' {
	return workMode === 'live' ? 'Live' : 'Autonomous';
}

export function formatWorkModeAnnouncement(workMode: WorkMode): string {
	return `${workModeLabel(workMode)} work mode active.`;
}

export function detectWorkModeSwitch(text: string): WorkModeSwitch | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed === '/live-co-development') {
		return { workMode: 'live', consumed: true, source: 'slash' };
	}
	if (trimmed === '/autonomous-delivery') {
		return { workMode: 'autonomous', consumed: true, source: 'slash' };
	}
	const alias = trimmed.match(/^\/work-mode\s+(live|autonomous)$/i);
	if (alias) {
		return {
			workMode: alias[1].toLowerCase() as WorkMode,
			consumed: true,
			source: 'slash'
		};
	}
	if (
		trimmed.startsWith('```') ||
		trimmed.startsWith('`') ||
		trimmed.startsWith('"') ||
		trimmed.startsWith('“')
	)
		return null;
	for (const candidate of NATURAL_PATTERNS) {
		if (candidate.pattern.test(trimmed)) {
			return { workMode: candidate.workMode, consumed: false, source: 'natural' };
		}
	}
	return null;
}

export function buildWorkModePreamble(workMode: WorkMode): string {
	const cadence =
		workMode === 'live'
			? [
					'Preserve running dev state.',
					'Make one small coherent change.',
					'Use cheapest targeted check.',
					'Return for immediate feedback.',
					'Use full gates only when asked to wrap.'
				]
			: [
					'Assume user is not watching.',
					'Work through safe coherent slices.',
					'Surface draft or preview when authorized.',
					'Continue proportional verification.'
				];
	return [
		`HUE Work mode: ${workModeLabel(workMode)}.`,
		'This controls cadence only. It does not authorize external effects.',
		'This is guidance, not deterministic enforcement.',
		...cadence,
		'When creating a file for the user, save it inside the Session working directory and end the response with `MEDIA: relative/path` for each file so HUE can attach it.',
		'Original user message follows exactly.',
		'---'
	].join('\n');
}

export function stripHermesPreamble(text: string): string {
	for (const workMode of ['autonomous', 'live'] as const) {
		const prefix = `${buildWorkModePreamble(workMode)}\n`;
		if (text.startsWith(prefix)) return text.slice(prefix.length);
	}
	return text;
}
