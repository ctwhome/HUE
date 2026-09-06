import { expect, test } from 'bun:test';
import { readProjectPanels, togglePanelState } from './panel-state';

test('persists each project panel independently with defaults', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};

	expect(readProjectPanels(storage, 'project-1')).toEqual({
		browser: true,
		excalidraw: false,
		git: false,
		files: false,
		terminal: false
	});
	expect(togglePanelState(storage, 'project-1', 'git', false)).toBe(true);
	expect(togglePanelState(storage, 'project-1', 'browser', true)).toBe(false);
	expect(togglePanelState(storage, 'project-1', 'terminal', false)).toBe(true);
	expect(readProjectPanels(storage, 'project-1')).toEqual({
		browser: false,
		excalidraw: false,
		git: true,
		files: false,
		terminal: true
	});
	expect(togglePanelState(storage, 'project-1', 'files', false)).toBe(true);
	expect(readProjectPanels(storage, 'project-1').files).toBe(true);
	expect(togglePanelState(storage, 'project-1', 'files', true)).toBe(false);
	expect(togglePanelState(storage, 'project-1', 'excalidraw', false)).toBe(true);
	expect(readProjectPanels(storage, 'project-1').excalidraw).toBe(true);
});
