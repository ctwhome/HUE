import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRepositories, resolveProjectRepository } from '$lib/server/services';
import { localSameOriginMutationAllowed } from '$lib/server/same-origin';
import {
	_projectFolderRepositories,
	_commitModelSelection,
	_commitReasoningSelection,
	_repositoryDiffOptions,
	_selectedRepositoryPath
} from './+server';

const temporaryDirectories: string[] = [];

test('nearby repository status reads reuse discovery but still validate canonical selection', async () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-repository-discovery-cache-'));
	temporaryDirectories.push(root);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: root });
	const first = await _projectFolderRepositories(root);
	const second = await _projectFolderRepositories(root);
	expect(second).toBe(first);
});

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('restricts repository discovery to the primary Project folder', async () => {
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

	const repositories = await _projectFolderRepositories(primary);
	expect(repositories).toEqual([{ path: 'apps/web', label: 'web' }]);
	await expect(
		resolveProjectRepository(primary, '../documentation/site', repositories)
	).rejects.toThrow('Repository is not part of this project');
	expect(await resolveProjectRepository(primary, 'apps/web', repositories)).toBe(realpathSync(app));
});

test('repository discovery skips generated trees and obeys explicit traversal bounds', async () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-project-repository-bounds-'));
	temporaryDirectories.push(root);
	const shallow = join(root, 'packages', 'app');
	const tooDeep = join(root, 'one', 'two', 'three');
	const generated = join(root, 'build', 'nested');
	for (const path of [shallow, tooDeep, generated]) {
		mkdirSync(path, { recursive: true });
		Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: path });
	}

	expect(await projectRepositories(root, { maxDepth: 2, maxDirectories: 20 })).toEqual([
		{ path: 'packages/app' }
	]);
	expect(await projectRepositories(root, { maxDepth: 10, maxDirectories: 1 })).toEqual([]);
});

test('repository reads replace a stale selection with the first discovered repository', async () => {
	expect(_selectedRepositoryPath([{ path: 'app' }, { path: 'docs' }], '.')).toBe('app');
});

test('diff reads reject an invalid selected repository and parse bounded options', async () => {
	expect(() => _selectedRepositoryPath([{ path: 'app' }], '../outside', true)).toThrow(
		'Repository is not part of this project'
	);
	expect(
		_repositoryDiffOptions(
			new URLSearchParams({ scope: 'branch', base: 'origin/main', file: 'src/app.ts' })
		)
	).toEqual({ scope: 'branch', base: 'origin/main', file: 'src/app.ts' });
	expect(() => _repositoryDiffOptions(new URLSearchParams({ scope: 'everything' }))).toThrow(
		'Invalid diff scope'
	);
});

test('repository mutations require a loopback same-origin request', async () => {
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

	expect(localSameOriginMutationAllowed(local, localUrl, '127.0.0.1')).toBe(true);
	expect(localSameOriginMutationAllowed(local, localUrl, '203.0.113.10')).toBe(false);
	expect(localSameOriginMutationAllowed(rebound, reboundUrl, '127.0.0.1')).toBe(false);
	expect(
		localSameOriginMutationAllowed(
			new Request(localUrl, {
				method: 'POST',
				headers: { host: localUrl.host, origin: localUrl.origin, forwarded: 'for=127.0.0.1' }
			}),
			localUrl,
			'127.0.0.1'
		)
	).toBe(false);
});

test('commit generation requires and combines the selected ACP model', async () => {
	expect(_commitModelSelection('openai', 'gpt-5')).toBe('openai:gpt-5');
	expect(() => _commitModelSelection('openai')).toThrow('Commit model is required');
	expect(_commitReasoningSelection('none')).toBe('none');
	expect(_commitReasoningSelection()).toBe('default');
	expect(() => _commitReasoningSelection('high')).toThrow('Invalid commit reasoning');
});
