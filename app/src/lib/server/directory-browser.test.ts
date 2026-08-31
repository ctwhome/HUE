import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectory, listDirectories } from './directory-browser';

const root = join(tmpdir(), `hue-directories-${crypto.randomUUID()}`);

afterEach(() => rmSync(root, { recursive: true, force: true }));

test('lists directories alphabetically and hides dot directories by default', () => {
	mkdirSync(join(root, 'Zulu'), { recursive: true });
	mkdirSync(join(root, 'Alpha'));
	mkdirSync(join(root, '.hidden'));

	expect(listDirectories(root, false).entries.map(({ name }) => name)).toEqual(['Alpha', 'Zulu']);
	expect(listDirectories(root, true).entries.map(({ name }) => name)).toEqual([
		'.hidden',
		'Alpha',
		'Zulu'
	]);
});

test('creates one directory inside the selected parent', () => {
	mkdirSync(root, { recursive: true });

	expect(createDirectory(root, 'New project')).toBe(realpathSync(join(root, 'New project')));
	expect(listDirectories(root).entries.map(({ name }) => name)).toContain('New project');
});

test('rejects folder names that escape the selected parent', () => {
	mkdirSync(root, { recursive: true });

	expect(() => createDirectory(root, '../outside')).toThrow('Folder name');
	expect(() => createDirectory(root, 'nested/folder')).toThrow('Folder name');
});
