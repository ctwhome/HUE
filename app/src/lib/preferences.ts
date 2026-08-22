export type HUEPreferences = {
	sendKey: 'enter' | 'mod-enter';
	theme: 'system' | 'light' | 'dark' | 'oled';
	density: 'comfortable' | 'compact';
	language: string;
	voice: string;
	showUsage: boolean;
};

export const defaultPreferences: HUEPreferences = {
	sendKey: 'enter',
	theme: 'system',
	density: 'comfortable',
	language: 'en',
	voice: 'hermes',
	showUsage: true
};

export function normalizePreferences(value: unknown): HUEPreferences {
	const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		sendKey: input.sendKey === 'mod-enter' ? 'mod-enter' : 'enter',
		theme: ['system', 'light', 'dark', 'oled'].includes(String(input.theme))
			? (input.theme as HUEPreferences['theme'])
			: 'system',
		density: input.density === 'compact' ? 'compact' : 'comfortable',
		language:
			typeof input.language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.language)
				? input.language
				: 'en',
		voice: typeof input.voice === 'string' && input.voice.trim() ? input.voice.trim() : 'hermes',
		showUsage: typeof input.showUsage === 'boolean' ? input.showUsage : true
	};
}

export function readPreferences(storage: Pick<Storage, 'getItem'>): HUEPreferences {
	try {
		return normalizePreferences(JSON.parse(storage.getItem('hue:preferences') ?? '{}'));
	} catch {
		return defaultPreferences;
	}
}

export function applyPreferences(root: HTMLElement, preferences: HUEPreferences) {
	root.dataset.theme = preferences.theme;
	root.dataset.density = preferences.density;
	root.dataset.sendKey = preferences.sendKey;
	root.dataset.voice = preferences.voice;
	root.dataset.showUsage = String(preferences.showUsage);
	root.lang = preferences.language;
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
