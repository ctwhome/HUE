import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	projectBranch,
	projectGitHubItems,
	mergeProjectSessionViews,
	projectRepositories,
	projectRepository,
	projectRepositoryAction,
	resolveProjectRepository,
	projectStagedDiff,
	projectRuntimeHealth,
	services,
	sessionMatchesProjectFolders,
	sessionMatchesProjectRoot
} from './services';
import { HUEStore } from './store';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('matches Session cwd under any canonical Project folder without prefix confusion', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-folders-'));
	const docsRoot = mkdtempSync(join(tmpdir(), 'hue-project-docs-'));
	const nested = join(docsRoot, 'packages', 'site');
	mkdirSync(nested, { recursive: true });
	temporaryDirectories.push(projectRoot, docsRoot);

	expect(sessionMatchesProjectFolders([projectRoot, docsRoot], nested)).toBe(true);
	expect(sessionMatchesProjectFolders([projectRoot], docsRoot)).toBe(false);
	expect(sessionMatchesProjectFolders([docsRoot], `${docsRoot}-sibling`)).toBe(false);
});

test('matches Hermes session cwd to Project root by canonical path', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'hue-project-root-'));
	temporaryDirectories.push(temporary);
	const projectRoot = join(temporary, 'project');
	const projectAlias = join(temporary, 'project-alias');
	const otherRoot = join(temporary, 'other');
	mkdirSync(projectRoot);
	mkdirSync(otherRoot);
	symlinkSync(projectRoot, projectAlias);

	expect(sessionMatchesProjectRoot(projectRoot, projectAlias)).toBe(true);
	expect(sessionMatchesProjectRoot(projectRoot, otherRoot)).toBe(false);
	expect(sessionMatchesProjectRoot(projectRoot, join(temporary, 'missing'))).toBe(false);
});

test('keeps old-root Sessions visible with an explicit restore contract after Project relocation', () => {
	const current = [{ sessionId: 'new-session', cwd: '/work/hue-new', title: 'Current' }];
	const stored = [
		{ sessionId: 'old-session', cwd: '/work/hue-old', icon: '🕰️' },
		{ sessionId: 'new-session', cwd: '/work/hue-new', icon: null }
	];

	expect(mergeProjectSessionViews(current, stored)).toEqual([
		expect.objectContaining({ sessionId: 'new-session', available: true, recovery: null }),
		expect.objectContaining({
			sessionId: 'old-session',
			cwd: '/work/hue-old',
			available: false,
			recovery: 'Restore the Session folder at /work/hue-old to resume it.'
		})
	]);
});

test('keeps a stored zero-history Session available while its cwd exists', () => {
	const stored = [{ sessionId: 'new-session', cwd: '/work/hue', icon: null }];

	expect(mergeProjectSessionViews([], stored, new Set(['/work/hue']))).toEqual([
		expect.objectContaining({ sessionId: 'new-session', available: true, recovery: null })
	]);
});

test('reports distinct actionable health for a missing Project root', () => {
	const missing = join(tmpdir(), `hue-missing-${crypto.randomUUID()}`);

	expect(projectRuntimeHealth(missing, { acp: 'idle', admin: 'idle' })).toEqual([
		expect.objectContaining({
			id: 'project',
			status: 'unavailable',
			action: 'Locate or remove Project'
		}),
		expect.objectContaining({ id: 'git', status: 'blocked' }),
		expect.objectContaining({ id: 'terminal', status: 'blocked' }),
		expect.objectContaining({ id: 'preview', status: 'blocked' }),
		expect.objectContaining({ id: 'acp', status: 'idle', action: 'Start or open a Session' }),
		expect.objectContaining({ id: 'admin', status: 'idle', action: 'Open Hermes settings' })
	]);
});

test('distinguishes a healthy Project root from optional Git and idle preview', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-health-'));
	temporaryDirectories.push(projectRoot);

	expect(projectRuntimeHealth(projectRoot, { acp: 'ready', admin: 'unavailable' })).toEqual([
		expect.objectContaining({ id: 'project', status: 'ready' }),
		expect.objectContaining({ id: 'git', status: 'idle', summary: 'Not a Git repository' }),
		expect.objectContaining({ id: 'terminal', status: 'ready' }),
		expect.objectContaining({ id: 'preview', status: 'idle' }),
		expect.objectContaining({ id: 'acp', status: 'ready' }),
		expect.objectContaining({ id: 'admin', status: 'unavailable' })
	]);
});

test('replaces services retained from an older server module', async () => {
	const globals = globalThis as typeof globalThis & { __hueServices?: unknown };
	const previousServices = globals.__hueServices;
	const previousDatabasePath = process.env.HUE_DATABASE_PATH;
	process.env.HUE_DATABASE_PATH = ':memory:';
	globals.__hueServices = { store: {} };

	try {
		const current = services();
		expect(current.store).toBeInstanceOf(HUEStore);
		current.terminals.dispose();
		await Promise.all([current.runtime.close(), current.admin.close()]);
		current.store.close();
	} finally {
		globals.__hueServices = previousServices;
		if (previousDatabasePath === undefined) delete process.env.HUE_DATABASE_PATH;
		else process.env.HUE_DATABASE_PATH = previousDatabasePath;
	}
});

test('reports the current Git branch for a Project root', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-branch-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'feature/context-bar'], { cwd: projectRoot });

	expect(projectBranch(projectRoot)).toBe('feature/context-bar');
});

test('reports read-only repository status, remotes, and worktrees', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'hue-project-repository-'));
	temporaryDirectories.push(temporary);
	const projectRoot = join(temporary, 'project');
	const worktreeRoot = join(temporary, 'review');
	mkdirSync(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'first\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'remote', 'add', 'origin', 'https://token@example.test/curi/hue.git'], {
		cwd: projectRoot
	});
	Bun.spawnSync(['git', 'worktree', 'add', '-b', 'review', worktreeRoot], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'changed\n');
	writeFileSync(join(projectRoot, 'new file.txt'), 'new\n');
	symlinkSync('/etc/passwd', join(projectRoot, 'unsafe-link'));

	expect(projectRepository(projectRoot)).toEqual({
		isRepository: true,
		branch: 'main',
		changes: [
			{ path: 'new file.txt', index: '?', worktree: '?', fileUrl: 'new file.txt' },
			{ path: 'tracked.txt', index: ' ', worktree: 'M', fileUrl: 'tracked.txt' },
			{ path: 'unsafe-link', index: '?', worktree: '?', fileUrl: null }
		],
		worktrees: [
			{ path: realpathSync(projectRoot), branch: 'main', head: expect.any(String) },
			{ path: realpathSync(worktreeRoot), branch: 'review', head: expect.any(String) }
		],
		remotes: [
			{
				name: 'origin',
				webUrl: 'https://example.test/curi/hue'
			}
		]
	});
});

test('groups open GitHub issues by milestone and lists pull requests for origin', () => {
	const calls: string[][] = [];
	const run = (_command: string, args: string[]) => {
		calls.push(args);
		if (args.includes('get-url')) {
			return { status: 0, stdout: 'https://github.com/curi/hue.git\n' };
		}
		return args[0] === 'issue'
			? {
					status: 0,
					stdout: JSON.stringify([
						{
							number: 42,
							title: 'Keep issue list focused',
							url: 'https://github.com/curi/hue/issues/42',
							milestone: { title: '1.0' }
						},
						{
							number: 43,
							title: 'Triage later',
							url: 'https://github.com/curi/hue/issues/43',
							milestone: null
						}
					])
				}
			: {
					status: 0,
					stdout: JSON.stringify([
						{
							number: 44,
							title: 'Review grouping',
							url: 'https://github.com/curi/hue/pull/44'
						}
					])
				};
	};

	expect(projectGitHubItems('/project', run)).toEqual({
		issueGroups: [
			{
				milestone: '1.0',
				issues: [
					{
						number: 42,
						title: 'Keep issue list focused',
						url: 'https://github.com/curi/hue/issues/42'
					}
				]
			},
			{
				milestone: null,
				issues: [
					{ number: 43, title: 'Triage later', url: 'https://github.com/curi/hue/issues/43' }
				]
			}
		],
		pullRequests: [
			{ number: 44, title: 'Review grouping', url: 'https://github.com/curi/hue/pull/44' }
		]
	});
	expect(calls).toEqual([
		['-C', '/project', 'remote', 'get-url', 'origin'],
		[
			'issue',
			'list',
			'--repo',
			'https://github.com/curi/hue',
			'--state',
			'open',
			'--limit',
			'20',
			'--json',
			'number,title,url,milestone'
		],
		[
			'pr',
			'list',
			'--repo',
			'https://github.com/curi/hue',
			'--state',
			'open',
			'--limit',
			'20',
			'--json',
			'number,title,url'
		]
	]);
});

test('reports a project without Git without treating it as an error', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-no-git-'));
	temporaryDirectories.push(projectRoot);

	expect(projectRepository(projectRoot)).toEqual({
		isRepository: false,
		branch: null,
		changes: [],
		worktrees: [],
		remotes: []
	});
});

test('discovers nested Git repositories and mutates only the selected repository', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-repositories-'));
	temporaryDirectories.push(projectRoot);
	const appRoot = join(projectRoot, 'app');
	const docsRoot = join(projectRoot, 'packages', 'docs');
	mkdirSync(appRoot, { recursive: true });
	mkdirSync(docsRoot, { recursive: true });
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: appRoot });
	Bun.spawnSync(['git', 'init', '-b', 'docs'], { cwd: docsRoot });
	writeFileSync(join(appRoot, 'app.txt'), 'app\n');
	writeFileSync(join(docsRoot, 'docs.txt'), 'docs\n');

	expect(projectRepositories(projectRoot)).toEqual([{ path: 'app' }, { path: 'packages/docs' }]);
	expect(resolveProjectRepository(projectRoot)).toBe(realpathSync(appRoot));
	const selectedRoot = resolveProjectRepository(projectRoot, 'packages/docs');
	expect(selectedRoot).toBe(realpathSync(docsRoot));

	projectRepositoryAction(selectedRoot, { action: 'stageAll' });
	expect(projectRepository(appRoot).changes).toEqual([
		expect.objectContaining({ path: 'app.txt', index: '?' })
	]);
	expect(projectRepository(docsRoot).changes).toEqual([
		expect.objectContaining({ path: 'docs.txt', index: 'A' })
	]);
});

test('prefers a project-root repository and rejects undiscovered paths', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-repository-root-'));
	temporaryDirectories.push(projectRoot);
	const nestedRoot = join(projectRoot, 'nested');
	mkdirSync(nestedRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'init', '-b', 'nested'], { cwd: nestedRoot });

	expect(projectRepositories(projectRoot)).toEqual([{ path: '.' }, { path: 'nested' }]);
	expect(resolveProjectRepository(projectRoot)).toBe(realpathSync(projectRoot));
	expect(() => resolveProjectRepository(projectRoot, '../outside')).toThrow(
		'Repository is not part of this project'
	);
	expect(() => resolveProjectRepository(projectRoot, 'missing')).toThrow(
		'Repository is not part of this project'
	);
});

test('stages, unstages, and commits project files without shell interpolation', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-actions-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'first\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'changed\n');
	writeFileSync(join(projectRoot, '--literal.txt'), 'safe\n');

	projectRepositoryAction(projectRoot, { action: 'stage', path: '--literal.txt' });
	expect(
		projectRepository(projectRoot).changes.find(({ path }) => path === '--literal.txt')?.index
	).toBe('A');
	projectRepositoryAction(projectRoot, { action: 'unstage', path: '--literal.txt' });
	expect(
		projectRepository(projectRoot).changes.find(({ path }) => path === '--literal.txt')?.index
	).toBe('?');
	projectRepositoryAction(projectRoot, { action: 'stageAll' });
	projectRepositoryAction(projectRoot, { action: 'commit', message: 'Commit from HUE' });

	expect(projectRepository(projectRoot).changes).toEqual([]);
	expect(
		Bun.spawnSync(['git', 'log', '-1', '--pretty=%s'], { cwd: projectRoot })
			.stdout.toString()
			.trim()
	).toBe('Commit from HUE');
});

test('reads only the bounded staged diff for commit generation', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-staged-diff-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'staged.txt'), 'staged content\n');
	writeFileSync(join(projectRoot, 'unstaged.txt'), 'unstaged content\n');
	Bun.spawnSync(['git', 'add', 'staged.txt'], { cwd: projectRoot });

	const diff = projectStagedDiff(projectRoot);
	expect(diff).toContain('staged content');
	expect(diff).not.toContain('unstaged content');
});

test('pushes the current branch and creates its upstream', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'hue-project-push-'));
	temporaryDirectories.push(temporary);
	const projectRoot = join(temporary, 'project');
	const remoteRoot = join(temporary, 'remote.git');
	mkdirSync(projectRoot);
	Bun.spawnSync(['git', 'init', '--bare', remoteRoot]);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'first\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'remote', 'add', 'origin', remoteRoot], { cwd: projectRoot });

	projectRepositoryAction(projectRoot, { action: 'push' });

	expect(
		Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: projectRoot })
			.stdout.toString()
			.trim()
	).toBe('origin/main');
});

test('rejects unknown repository mutations', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-invalid-action-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });

	expect(() => projectRepositoryAction(projectRoot, { action: 'destroy' } as never)).toThrow(
		'Unknown Git action'
	);
});
