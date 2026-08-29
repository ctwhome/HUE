export const themes = [
	'system',
	'light',
	'github-light',
	'solarized-light',
	'dark',
	'tokyo-night',
	'nord',
	'oled'
] as const;

export type HUETheme = (typeof themes)[number];

export type HUEPreferences = {
	sendKey: 'enter' | 'mod-enter';
	theme: HUETheme;
	density: 'comfortable' | 'compact';
	chatFontSize: number;
	language: string;
	voice: string;
	showUsage: boolean;
	hiddenFilePatterns: string;
};

export const defaultPreferences: HUEPreferences = {
	sendKey: 'enter',
	theme: 'system',
	density: 'comfortable',
	chatFontSize: 14,
	language: 'en',
	voice: 'hermes',
	showUsage: true,
	hiddenFilePatterns: '.DS_Store'
};

export function normalizePreferences(value: unknown): HUEPreferences {
	const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		sendKey: input.sendKey === 'mod-enter' ? 'mod-enter' : 'enter',
		theme: themes.includes(input.theme as HUETheme)
			? (input.theme as HUEPreferences['theme'])
			: 'system',
		density: input.density === 'compact' ? 'compact' : 'comfortable',
		chatFontSize:
			typeof input.chatFontSize === 'number'
				? Math.min(20, Math.max(12, input.chatFontSize))
				: defaultPreferences.chatFontSize,
		language:
			typeof input.language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.language)
				? input.language
				: 'en',
		voice: typeof input.voice === 'string' && input.voice.trim() ? input.voice.trim() : 'hermes',
		showUsage: typeof input.showUsage === 'boolean' ? input.showUsage : true,
		hiddenFilePatterns:
			typeof input.hiddenFilePatterns === 'string'
				? input.hiddenFilePatterns.replaceAll('\r\n', '\n').replaceAll('\r', '\n').slice(0, 10_000)
				: defaultPreferences.hiddenFilePatterns
	};
}

export function readPreferences(storage: Pick<Storage, 'getItem'>): HUEPreferences {
	try {
		return normalizePreferences(JSON.parse(storage.getItem('hue:preferences') ?? '{}'));
	} catch {
		return defaultPreferences;
	}
}

export function isDarkTheme(theme: HUETheme, prefersDark: boolean) {
	return (
		theme === 'dark' ||
		theme === 'tokyo-night' ||
		theme === 'nord' ||
		theme === 'oled' ||
		(theme === 'system' && prefersDark)
	);
}

export function themeChromeColor(theme: HUETheme, prefersDark: boolean) {
	if (theme === 'oled') return '#000000';
	if (theme === 'tokyo-night') return '#16161e';
	if (theme === 'nord') return '#2e3440';
	if (theme === 'github-light') return '#f6f8fa';
	if (theme === 'solarized-light') return '#eee8d5';
	if (theme === 'light' || (theme === 'system' && !prefersDark)) return '#f3f3f3';
	return '#050505';
}

export function applyPreferences(root: HTMLElement, preferences: HUEPreferences) {
	root.dataset.theme = preferences.theme;
	root.dataset.density = preferences.density;
	root.dataset.sendKey = preferences.sendKey;
	root.dataset.voice = preferences.voice;
	root.dataset.showUsage = String(preferences.showUsage);
	root.style.setProperty('--chat-font-size', `${preferences.chatFontSize}px`);
	root.lang = preferences.language;
	const prefersDark =
		typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
	root.ownerDocument
		.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
		?.setAttribute('content', themeChromeColor(preferences.theme, prefersDark));
}

export function shouldSendMessage(
	event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>,
	sendKey: HUEPreferences['sendKey']
) {
	if (event.key !== 'Enter' || event.shiftKey) return false;
	return sendKey === 'mod-enter'
		? event.metaKey || event.ctrlKey
		: !event.metaKey && !event.ctrlKey;
}
