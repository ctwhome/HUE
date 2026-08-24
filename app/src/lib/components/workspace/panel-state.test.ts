import { expect, test } from 'bun:test';
import { readPanelState, readProjectPanels, togglePanelState } from './panel-state';

test('persists project panel state with defaults', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};

	expect(readPanelState(storage, 'project-1', 'browser', true)).toBe(true);
	expect(togglePanelState(storage, 'project-1', 'browser', true)).toBe(false);
	expect(readPanelState(storage, 'project-1', 'browser', true)).toBe(false);
	expect(readProjectPanels(storage, 'project-1')).toEqual({
		browserOpen: false,
		terminalOpen: false
	});
});
