import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export function listDirectories(input = homedir(), showHidden = false) {
	const path = realpathSync(input);
	return {
		path,
		name: basename(path) || path,
		parent: dirname(path) === path ? null : dirname(path),
		entries: readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith('.')))
			.map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
			.sort((left, right) => left.name.localeCompare(right.name))
	};
}

export function createDirectory(parent: string, input: string) {
	const name = input.trim();
	if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
		throw new Error('Folder name must be one directory name');
	}
	const path = join(realpathSync(parent), name);
	mkdirSync(path, { mode: 0o700 });
	return path;
}
