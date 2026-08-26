import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	projectRepository,
	projectRepositoryAction,
	resolveProjectRepository
} from '$lib/server/services';
import {
	_projectFolderRepositories,
	_repositoryMutationAllowed,
	_selectedRepositoryPath
} from './+server';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('discovers nested repositories across Project folders and mutates only the selected repo', () => {
	const parent = mkdtempSync(join(tmpdir(), 'hue-project-repository-folders-'));
	temporaryDirectories.push(parent);
	const primary = join(parent, 'workspace');
	const secondary = join(parent, 'documentation');
	const app = join(primary, 'apps', 'web');
	const docs = join(secondary, 'site');
	mkdirSync(app, { recursive: true });
	mkdirSync(docs, { recursive: true });
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: app });
	Bun.spawnSync(['git', 'init', '-b', 'docs'], { cwd: docs });
	writeFileSync(join(app, 'app.txt'), 'app\n');
	writeFileSync(join(docs, 'docs.txt'), 'docs\n');

	const repositories = _projectFolderRepositories(primary, [primary, secondary]);
	expect(repositories).toEqual([
		{ path: 'apps/web', label: 'web' },
		{ path: '../documentation/site', label: 'site' }
	]);
	const selected = resolveProjectRepository(primary, '../documentation/site', repositories);
	projectRepositoryAction(selected, { action: 'stageAll' });

	expect(projectRepository(app).changes[0]).toEqual(
		expect.objectContaining({ path: 'app.txt', index: '?' })
	);
	expect(projectRepository(docs).changes[0]).toEqual(
		expect.objectContaining({ path: 'docs.txt', index: 'A' })
	);
});

test('repository reads replace a stale selection with the first discovered repository', () => {
	expect(_selectedRepositoryPath([{ path: 'app' }, { path: 'docs' }], '.')).toBe('app');
});

test('repository mutations require a loopback same-origin request', () => {
	const localUrl = new URL('http://127.0.0.1/api/projects/project-1/repository');
	const local = new Request(localUrl, {
		method: 'POST',
		headers: { host: '127.0.0.1', origin: localUrl.origin }
	});
	const reboundUrl = new URL('http://attacker.example/api/projects/project-1/repository');
	const rebound = new Request(reboundUrl, {
		method: 'POST',
		headers: { host: 'attacker.example', origin: reboundUrl.origin }
	});

	expect(_repositoryMutationAllowed(local, '127.0.0.1')).toBe(true);
	expect(_repositoryMutationAllowed(local, '203.0.113.10')).toBe(false);
	expect(_repositoryMutationAllowed(rebound, '127.0.0.1')).toBe(false);
});
