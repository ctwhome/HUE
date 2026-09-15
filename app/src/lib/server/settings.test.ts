import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsFile } from './settings';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'hue-settings-'));
	roots.push(root);
	const path = join(root, 'settings.json');
	return { path, file: new SettingsFile(path) };
}

test('creates readable JSON defaults and persists preference edits', () => {
	const { path, file } = fixture();
	const initial = file.read();
	expect(initial.settings.preferences.theme).toBe('system');
	const settings = structuredClone(initial.settings);
	settings.preferences.theme = 'nord';
	file.save(settings, initial.revision);
	expect(JSON.parse(readFileSync(path, 'utf8')).preferences.theme).toBe('nord');
	expect(new SettingsFile(path).read().settings.preferences.theme).toBe('nord');
});

test('external changes are authoritative and stale saves cannot overwrite them', () => {
	const { path, file } = fixture();
	const initial = file.read();
	const external = structuredClone(initial.settings);
	external.preferences.theme = 'oled';
	writeFileSync(path, JSON.stringify(external, null, 2));
	expect(file.read().settings.preferences.theme).toBe('oled');
	expect(() => file.save(initial.settings, initial.revision)).toThrow('changed');
	expect(JSON.parse(readFileSync(path, 'utf8')).preferences.theme).toBe('oled');
});

test('invalid external JSON is reported without replacing user edits', () => {
	const { path, file } = fixture();
	const initial = file.read();
	writeFileSync(path, '{ unfinished');
	expect(() => file.read()).toThrow();
	expect(() => file.save(initial.settings, initial.revision)).toThrow();
	expect(readFileSync(path, 'utf8')).toBe('{ unfinished');
});

test('rejects invalid preferences without changing the file', () => {
	const { path, file } = fixture();
	const initial = file.read();
	const before = readFileSync(path, 'utf8');
	expect(() => file.save({ ...initial.settings, preferences: { theme: 'typo' } }, initial.revision)).toThrow();
	expect(readFileSync(path, 'utf8')).toBe(before);
});
