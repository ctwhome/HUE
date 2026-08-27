import { expect, test } from 'bun:test';
import {
	defaultRepositoryLayout,
	readRepositoryLayout,
	resizeRepositoryPanels,
	toggleRepositoryPanel
} from './repository-layout';

const storage = (entries: Record<string, string> = {}) => {
	const values = new Map(Object.entries(entries));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		values
	};
};

test('repository layout round-trips panel visibility and sizes', () => {
	const store = storage();
	const layout = defaultRepositoryLayout();
	toggleRepositoryPanel(store, 'project-1', layout, 'git');
	resizeRepositoryPanels(store, 'project-1', layout, 'git', 'worktrees', 240, 120);

	expect(readRepositoryLayout(store, 'project-1')).toMatchObject({
		gitOpen: false,
		worktreesOpen: true,
		panelSizes: { git: 240, worktrees: 120, github: 1 }
	});
});

test('repository layout ignores malformed saved sizes', () => {
	const store = storage({
		'hue:project-tools:project-1:panel-sizes': '{"git":-2,"worktrees":"wide","github":4}'
	});

	expect(readRepositoryLayout(store, 'project-1').panelSizes).toEqual({
		git: 1,
		worktrees: 1,
		github: 4
	});
});
