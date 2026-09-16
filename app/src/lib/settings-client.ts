import { writable } from 'svelte/store';
import { onMount } from 'svelte';
import { applyPreferences } from './preferences';
import { defaultSettings, getSetting, setSetting, type SettingsSnapshot, type SettingsValue } from './settings';

let snapshot: SettingsSnapshot = { settings: defaultSettings(), revision: '', path: '~/.hue/settings.json' };
let pending = 0;
let generation = 0;
let refreshing = false;
let queue = Promise.resolve();
const listeners = new Set<() => void>();
let observed: Set<string> | undefined;
export const settingsStatus = writable({ error: '', pending: false, path: snapshot.path });

export function initializeSettings(initial: SettingsSnapshot | null, error: string) {
	// Detach Svelte page-data proxies: storage reads must not subscribe layout effects to their own writes.
	if (initial) apply(JSON.parse(JSON.stringify(initial)));
	settingsStatus.set({ error, pending: false, path: snapshot.path });
}

function apply(next: SettingsSnapshot) {
	snapshot = next;
	applyPreferences(document.documentElement, next.settings.preferences);
	window.dispatchEvent(new CustomEvent('hue:preferences', { detail: next.settings.preferences }));
	window.dispatchEvent(new CustomEvent('hue:chat-background'));
	for (const listener of listeners) listener();
}

async function request(init?: RequestInit): Promise<SettingsSnapshot> {
	const response = await fetch('/api/settings', { cache: 'no-store', ...init, headers: { 'content-type': 'application/json' } });
	const body = await response.json();
	if (!response.ok) throw new Error(body.error ?? 'Could not save settings');
	return body;
}

export async function refreshSettings() {
	if (pending || refreshing) return;
	refreshing = true;
	const started = generation;
	try {
		const next = await request();
		if (pending || started !== generation) return;
		if (next.revision !== snapshot.revision) apply(next);
		settingsStatus.set({ error: '', pending: false, path: next.path });
	} catch (cause) {
		if (started !== generation) return;
		settingsStatus.set({ error: String(cause instanceof Error ? cause.message : cause), pending: false, path: snapshot.path });
	} finally { refreshing = false; }
}

export function watchSettings(read: () => void, scope: () => unknown = () => null) {
	onMount(() => {
		let values = new Map<string, string | undefined>();
		let currentScope: unknown;
		const run = () => {
			currentScope = scope();
			observed = new Set();
			try { read(); }
			finally {
				values = new Map([...observed].map((key) => [key, JSON.stringify(getSetting(snapshot.settings, key))]));
				observed = undefined;
			}
		};
		const changed = () => {
			if (scope() !== currentScope || !values.size || [...values].some(([key, value]) => JSON.stringify(getSetting(snapshot.settings, key)) !== value)) run();
		};
		run();
		listeners.add(changed);
		return () => { listeners.delete(changed); };
	});
}

function update(key: string, value: SettingsValue | undefined) {
	if (JSON.stringify(getSetting(snapshot.settings, key)) === JSON.stringify(value)) return;
	if (!snapshot.revision) {
		settingsStatus.update((status) => ({ ...status, error: 'Settings are unavailable. Open settings.json to repair the file, then retry your change.' }));
		return;
	}
	const expected = structuredClone(getSetting(snapshot.settings, key) ?? null);
	generation++;
	setSetting(snapshot.settings, key, value);
	pending++;
	settingsStatus.set({ error: '', pending: true, path: snapshot.path });
	queue = queue.then(async () => {
		try {
			const next = await request({ method: 'PATCH', body: JSON.stringify({ key, value, expected, remove: value === undefined }), keepalive: true });
			if (pending === 1) apply(next);
		} catch (cause) {
			settingsStatus.set({ error: cause instanceof Error ? cause.message : String(cause), pending: pending > 1, path: snapshot.path });
			try { if (pending === 1) apply(await request()); } catch { /* Keep the unsaved value visible until the file is repaired. */ }
		} finally {
			pending--;
			settingsStatus.update((status) => ({ ...status, pending: pending > 0 }));
		}
	});
}

export const settingsStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
	getItem(key) {
		observed?.add(key);
		const value = getSetting(snapshot.settings, key);
		return value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value);
	},
	setItem(key, text) {
		let value: SettingsValue = text;
		try { value = JSON.parse(text); } catch { /* Plain string setting. */ }
		update(key, value);
	},
	removeItem(key) { update(key, undefined); }
};

export async function readSettingsFile(): Promise<{ text: string; revision: string; path: string }> {
	await queue;
	const response = await fetch('/api/settings?raw=1', { cache: 'no-store' });
	const body = await response.json();
	if (!response.ok) throw new Error(body.error ?? 'Could not read settings.json');
	return body;
}
export async function saveSettingsFile(settings: unknown, revision: string) {
	await queue;
	generation++;
	pending++;
	try {
		const next = await request({ method: 'PUT', body: JSON.stringify({ settings, revision }) });
		apply(next);
		settingsStatus.set({ error: '', pending: false, path: next.path });
		return next;
	} finally { pending--; }
}
