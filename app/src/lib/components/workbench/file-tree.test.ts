import { expect, test } from 'bun:test';
import { restoreTreeFocus, treeKeyboardAction, visibleFileEntries } from './file-tree';
import type { FileEntry } from './file-types';

const entry = (path: string, type: FileEntry['type']): FileEntry => ({
	path,
	name: path.split('/').at(-1)!,
	type,
	size: 0,
	mtime: new Date(0).toISOString()
});

test('tree focus restores to visible parent after collapse and first item after refresh', () => {
	expect(restoreTreeFocus(entries, new Set(), 'src/lib/a.ts')).toBe('src');
	expect(restoreTreeFocus(entries, new Set(), 'missing')).toBe('README.md');
});
const entries = [
	entry('README.md', 'file'),
	entry('src', 'directory'),
	entry('src/lib', 'directory'),
	entry('src/lib/a.ts', 'file'),
	entry('src/main.ts', 'file'),
	entry('z.txt', 'file')
];

test('visible tree order is type-safe and follows expanded ancestors', () => {
	expect(visibleFileEntries(entries, new Set()).map(({ path }) => path)).toEqual([
		'README.md',
		'src',
		'z.txt'
	]);
	expect(visibleFileEntries(entries, new Set(['src'])).map(({ path }) => path)).toEqual([
		'README.md',
		'src',
		'src/lib',
		'src/main.ts',
		'z.txt'
	]);
});

test('tree keyboard action supports roving order, boundaries, expansion, child, and parent', () => {
	const collapsed = new Set<string>();
	expect(treeKeyboardAction(entries, collapsed, 'src', 'ArrowUp')).toEqual({
		focusPath: 'README.md'
	});
	expect(treeKeyboardAction(entries, collapsed, 'src', 'Home')).toEqual({
		focusPath: 'README.md'
	});
	expect(treeKeyboardAction(entries, collapsed, 'src', 'End')).toEqual({ focusPath: 'z.txt' });
	expect(treeKeyboardAction(entries, collapsed, 'src', 'ArrowRight')).toEqual({
		focusPath: 'src',
		expand: 'src'
	});
	const expanded = new Set(['src']);
	expect(treeKeyboardAction(entries, expanded, 'src', 'ArrowRight')).toEqual({
		focusPath: 'src/lib'
	});
	expect(treeKeyboardAction(entries, expanded, 'src/main.ts', 'ArrowLeft')).toEqual({
		focusPath: 'src'
	});
	expect(treeKeyboardAction(entries, expanded, 'src', 'ArrowLeft')).toEqual({
		focusPath: 'src',
		collapse: 'src'
	});
});
