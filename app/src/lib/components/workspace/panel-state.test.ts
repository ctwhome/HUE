import { expect, test } from 'bun:test';
import { readProjectTool, toggleProjectTool } from './panel-state';

test('persists one active project tool', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};

	expect(readProjectTool(storage, 'project-1')).toBe('browser');
	expect(toggleProjectTool(storage, 'project-1', 'git', 'browser')).toBe('git');
	expect(readProjectTool(storage, 'project-1')).toBe('git');
	expect(toggleProjectTool(storage, 'project-1', 'terminal', 'git')).toBe('terminal');
	expect(toggleProjectTool(storage, 'project-1', 'terminal', 'terminal')).toBe(null);
	expect(readProjectTool(storage, 'project-1')).toBe(null);
});
