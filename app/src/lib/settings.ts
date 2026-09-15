import { defaultPreferences, normalizePreferences, type HUEPreferences } from './preferences';

export type SettingsValue = string | number | boolean | null | SettingsValue[] | { [key: string]: SettingsValue };
export type HUESettings = { preferences: HUEPreferences; [key: string]: SettingsValue };
export type SettingsSnapshot = { settings: HUESettings; revision: string; path: string };

export const defaultSettings = (): HUESettings => ({
	preferences: { ...defaultPreferences },
	notification: { sound: false, foreground: false },
	shell: { projects: { open: true, width: 220 }, sessions: { open: true, width: 320 } },
	'chat-background': {},
	'last-session-selections': {},
	'commit-message-model': 'openai-codex:gpt-5.6-luna',
	'commit-message-reasoning': 'default',
	'project-tools': {},
	'project-files': {},
	'project-browser': {},
	'project-excalidraw': {},
	'project-order': [],
	'project-group-order': [],
	'project-groups': { collapsed: [] },
	'session-order': {},
	'session-panes': {},
	browser: { projects: {}, 'hidden-ports': [], 'port-notes': {} },
	hermes: { 'error-logs-open': false }
});

export function validateSettings(value: unknown): HUESettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be a JSON object');
	const input = value as Record<string, unknown>;
	const defaults = defaultSettings();
	for (const [key, entry] of Object.entries(input)) {
		if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown settings section: ${key}`);
		const expected = defaults[key];
		if (Array.isArray(expected) ? !Array.isArray(entry) : typeof expected === 'object' ? !entry || typeof entry !== 'object' || Array.isArray(entry) : typeof entry !== typeof expected) throw new Error(`Invalid settings section: ${key}`);
	}
	const preferences = input.preferences;
	if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('preferences must be an object');
	const normalized = normalizePreferences(preferences);
	for (const [key, entry] of Object.entries(preferences)) {
		if (!Object.hasOwn(defaultPreferences, key) || entry !== normalized[key as keyof HUEPreferences]) throw new Error(`Invalid preference: ${key}`);
	}
	function validate(entry: unknown, depth = 0): void {
		if (depth > 20) throw new Error('Settings nesting exceeds 20 levels');
		if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
		if (typeof entry === 'number' && Number.isFinite(entry)) return;
		if (Array.isArray(entry)) { entry.forEach((item) => validate(item, depth + 1)); return; }
		if (!entry || typeof entry !== 'object') throw new Error('Invalid settings value');
		for (const [key, item] of Object.entries(entry)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid settings key');
			validate(item, depth + 1);
		}
	}
	validate(value);
	return { ...defaultSettings(), ...input, preferences: normalized } as HUESettings;
}

export function settingsPath(key: string) {
	if (!key.startsWith('hue:')) throw new Error('Invalid HUE settings key');
	const path = key.slice(4).split(':');
	if (path.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Invalid settings key');
	return path;
}

export function getSetting(settings: HUESettings, key: string): SettingsValue | undefined {
	let value: SettingsValue | undefined = settings;
	for (const part of settingsPath(key)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		value = Object.hasOwn(value, part) ? value[part] : undefined;
	}
	return value;
}

export function setSetting(settings: HUESettings, key: string, value: SettingsValue | undefined) {
	const path = settingsPath(key);
	let parent: Record<string, SettingsValue> = settings;
	for (const part of path.slice(0, -1)) {
		const child = parent[part];
		if (!child || typeof child !== 'object' || Array.isArray(child)) parent[part] = {};
		parent = parent[part] as Record<string, SettingsValue>;
	}
	if (value === undefined) delete parent[path.at(-1)!];
	else parent[path.at(-1)!] = value;
}
