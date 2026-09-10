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
	projectRepositoryDiff,
	resolveProjectRepository,
	projectStagedDiff,
	projectRuntimeHealth,
	services,
	shutdownServices,
	sessionMatchesProjectFolders,
	sessionMatchesProjectRoot
} from './services';
import { HUEStore } from './store';
import { runCommand } from './command';
import { DeliveryUncertainError, MessageDispatcher } from './message-dispatcher';

const temporaryDirectories: string[] = [];

test('Git branch lookup yields to unrelated event-loop work', async () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-async-git-'));
	temporaryDirectories.push(root);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: root });
	const pending = projectBranch(root);
	expect(pending).toBeInstanceOf(Promise);
	expect(await pending).toBe('main');
});

test('process waits leave timers responsive and enforce timeout and output bounds', async () => {
	let ticked = false;
	const timer = setTimeout(() => (ticked = true), 5);
	const pending = runCommand(
		process.execPath,
		['-e', 'setTimeout(() => console.log("finished"), 50)'],
		{ timeout: 1_000 }
	);
	await Bun.sleep(20);
	expect(ticked).toBe(true);
	expect((await pending).stdout.toString()).toBe('finished\n');
	clearTimeout(timer);
	const timeout = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
		timeout: 20
	});
	expect(timeout.status).not.toBe(0);
	const overflow = await runCommand(process.execPath, ['-e', 'console.log("x".repeat(10000))'], {
		timeout: 1_000,
		maxBuffer: 100
	});
	expect(overflow.error?.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
	expect(overflow.stdout.byteLength).toBeLessThanOrEqual(100);
});

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('matches Session cwd under any canonical Project folder without prefix confusion', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-folders-'));
	const docsRoot = mkdtempSync(join(tmpdir(), 'hue-project-docs-'));
	const nested = join(docsRoot, 'packages', 'site');
	mkdirSync(nested, { recursive: true });
	temporaryDirectories.push(projectRoot, docsRoot);

	expect(sessionMatchesProjectFolders([projectRoot, docsRoot], nested)).toBe(true);
	expect(sessionMatchesProjectFolders([projectRoot], docsRoot)).toBe(false);
	expect(sessionMatchesProjectFolders([docsRoot], `${docsRoot}-sibling`)).toBe(false);
});

test('matches Hermes session cwd to Project root by canonical path', async () => {
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

test('keeps old-root Sessions visible with an explicit restore contract after Project relocation', async () => {
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

test('keeps a stored zero-history Session available while its cwd exists', async () => {
	const stored = [{ sessionId: 'new-session', cwd: '/work/hue', icon: null }];

	expect(mergeProjectSessionViews([], stored, new Set(['/work/hue']))).toEqual([
		expect.objectContaining({ sessionId: 'new-session', available: true, recovery: null })
	]);
});

test('reports distinct actionable health for a missing Project root', async () => {
	const missing = join(tmpdir(), `hue-missing-${crypto.randomUUID()}`);

	expect(await projectRuntimeHealth(missing, { acp: 'idle', admin: 'idle' })).toEqual([
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

test('distinguishes a healthy Project root from optional Git and idle preview', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-health-'));
	temporaryDirectories.push(projectRoot);

	expect(await projectRuntimeHealth(projectRoot, { acp: 'ready', admin: 'unavailable' })).toEqual([
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
	const previousCommand = process.env.HUE_HERMES_COMMAND;
	process.env.HUE_HERMES_COMMAND = '/usr/bin/false';
	process.env.HUE_DATABASE_PATH = ':memory:';
	const calls: string[] = [];
	let drained!: () => void;
	globals.__hueServices = {
		store: { close: () => calls.push('store') },
		terminals: { dispose: () => calls.push('terminals') },
		schedules: { close: () => calls.push('schedules') },
		externalCron: { close: async () => calls.push('externalCron') },
		dispatcher: {
			close: () =>
				new Promise<void>((resolve) => {
					calls.push('dispatcher');
					drained = resolve;
				})
		},
		notifications: { close: async () => calls.push('notifications') },
		runtime: { close: async () => calls.push('runtime') },
		opencodeRuntime: { close: async () => calls.push('opencode') },
		admin: { close: async () => calls.push('admin') }
	};

	try {
		expect(() => services()).toThrow('Services are restarting');
		await Bun.sleep(1);
		expect(calls).not.toContain('store');
		expect(() => services()).toThrow('Services are restarting');
		expect(calls.filter((call) => call === 'dispatcher')).toHaveLength(1);
		drained();
		await Bun.sleep(1);
		expect(calls.at(-1)).toBe('store');
		const current = services();
		expect(current.store).toBeInstanceOf(HUEStore);
		current.terminals.dispose();
		current.schedules.close();
		await current.externalCron.close();
		await current.dispatcher.close();
		await current.notifications.close();
		await Promise.all([
			current.runtime.close(),
			current.opencodeRuntime.close(),
			current.admin.close()
		]);
		current.store.close();
	} finally {
		globals.__hueServices = previousServices;
		if (previousDatabasePath === undefined) delete process.env.HUE_DATABASE_PATH;
		else process.env.HUE_DATABASE_PATH = previousDatabasePath;
		if (previousCommand === undefined) delete process.env.HUE_HERMES_COMMAND;
		else process.env.HUE_HERMES_COMMAND = previousCommand;
	}
});

test('shuts down the aggregate service set only once', async () => {
	const globals = globalThis as typeof globalThis & {
		__hueServices?: unknown;
		__hueShutdown?: Promise<void>;
	};
	const previousServices = globals.__hueServices;
	const previousShutdown = globals.__hueShutdown;
	const calls: string[] = [];
	globals.__hueShutdown = undefined;
	globals.__hueServices = {
		store: { close: () => calls.push('store') },
		runtime: { close: async () => calls.push('runtime') },
		opencodeRuntime: { close: async () => calls.push('opencode') },
		admin: { close: async () => calls.push('admin') },
		dispatcher: { close: async () => calls.push('dispatcher') },
		notifications: { close: async () => calls.push('notifications') },
		schedules: { close: () => calls.push('schedules') },
		terminals: { dispose: () => calls.push('terminals') }
	};
	try {
		await Promise.all([shutdownServices(), shutdownServices()]);
		expect(calls).toEqual([
			'terminals',
			'schedules',
			'dispatcher',
			'notifications',
			'runtime',
			'opencode',
			'admin',
			'store'
		]);
	} finally {
		globals.__hueServices = previousServices;
		globals.__hueShutdown = previousShutdown;
	}
});

test('aggregate retirement persists interrupted delivery before closing its store', async () => {
	const globals = globalThis as typeof globalThis & { __hueServices?: unknown };
	const previous = globals.__hueServices;
	const store = new HUEStore(':memory:');
	store.upsertSession(null, { sessionId: 'retiring-session', cwd: '/tmp' });
	let interrupt!: (cause: Error) => void;
	let started!: () => void;
	const running = new Promise<void>((resolve) => (started = resolve));
	const runtime = {
		hasSessionState: () => true,
		resumeSession: async () => {},
		prompt: () =>
			new Promise<void>((_, reject) => {
				interrupt = reject;
				started();
			}),
		close: async () => interrupt(new DeliveryUncertainError('Retired ACP connection'))
	};
	const dispatcher = new MessageDispatcher(store, runtime);
	dispatcher.submit({
		id: 'retiring-message',
		projectId: null,
		sessionId: 'retiring-session',
		text: 'Run once',
		images: []
	});
	await running;
	let statusAtClose: string | undefined;
	const closeStore = store.close.bind(store);
	store.close = () => {
		statusAtClose = store.getMessage('retiring-message')?.status;
		closeStore();
	};
	globals.__hueServices = {
		store,
		dispatcher,
		runtime,
		opencodeRuntime: { close: async () => {} },
		admin: { close: async () => {} },
		externalCron: { close: async () => {} },
		notifications: { close: async () => {} },
		schedules: { close: () => {} },
		terminals: { dispose: () => {} }
	};
	try {
		expect(() => services()).toThrow('Services are restarting');
		await shutdownServices();
		expect(statusAtClose).toBe('unknown');
	} finally {
		globals.__hueServices = previous;
	}
});

test('reports the current Git branch for a Project root', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-branch-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'feature/context-bar'], { cwd: projectRoot });

	expect(await projectBranch(projectRoot)).toBe('feature/context-bar');
});

test('reports read-only repository status, remotes, and worktrees', async () => {
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

	expect(await projectRepository(projectRoot)).toEqual({
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

test('groups open GitHub issues by milestone and lists pull requests for origin', async () => {
	const calls: string[][] = [];
	const run = async (_command: string, args: string[]) => {
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

	expect(await projectGitHubItems('/project', run)).toEqual({
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
			'1000',
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
			'1000',
			'--json',
			'number,title,url'
		]
	]);
});

test('reports a project without Git without treating it as an error', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-no-git-'));
	temporaryDirectories.push(projectRoot);

	expect(await projectRepository(projectRoot)).toEqual({
		isRepository: false,
		branch: null,
		changes: [],
		worktrees: [],
		remotes: []
	});
});

test('discovers nested Git repositories and mutates only the selected repository', async () => {
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

	expect(await projectRepositories(projectRoot)).toEqual([
		{ path: 'app' },
		{ path: 'packages/docs' }
	]);
	expect(await resolveProjectRepository(projectRoot)).toBe(realpathSync(appRoot));
	const selectedRoot = await resolveProjectRepository(projectRoot, 'packages/docs');
	expect(selectedRoot).toBe(realpathSync(docsRoot));

	await projectRepositoryAction(selectedRoot, { action: 'stageAll' });
	expect((await projectRepository(appRoot)).changes).toEqual([
		expect.objectContaining({ path: 'app.txt', index: '?' })
	]);
	expect((await projectRepository(docsRoot)).changes).toEqual([
		expect.objectContaining({ path: 'docs.txt', index: 'A' })
	]);
});

test('prefers a project-root repository and rejects undiscovered paths', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-repository-root-'));
	temporaryDirectories.push(projectRoot);
	const nestedRoot = join(projectRoot, 'nested');
	mkdirSync(nestedRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'init', '-b', 'nested'], { cwd: nestedRoot });

	expect(await projectRepositories(projectRoot)).toEqual([{ path: '.' }, { path: 'nested' }]);
	expect(await resolveProjectRepository(projectRoot)).toBe(realpathSync(projectRoot));
	await expect(resolveProjectRepository(projectRoot, '../outside')).rejects.toThrow(
		'Repository is not part of this project'
	);
	await expect(resolveProjectRepository(projectRoot, 'missing')).rejects.toThrow(
		'Repository is not part of this project'
	);
});

test('cached repository discovery cannot authorize removed repositories or symlink escapes', async () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-repository-canonical-'));
	const outside = mkdtempSync(join(tmpdir(), 'hue-repository-outside-'));
	temporaryDirectories.push(root, outside);
	const nested = join(root, 'nested');
	mkdirSync(nested);
	Bun.spawnSync(['git', 'init'], { cwd: nested });
	const repositories = await projectRepositories(root);
	rmSync(join(nested, '.git'), { recursive: true });
	await expect(resolveProjectRepository(root, 'nested', repositories)).rejects.toThrow(
		'Repository is not part'
	);
	rmSync(nested, { recursive: true });
	symlinkSync(outside, nested);
	await expect(resolveProjectRepository(root, 'nested', repositories)).rejects.toThrow(
		'Repository is not part'
	);
});

test('stages, unstages, and commits project files without shell interpolation', async () => {
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

	await projectRepositoryAction(projectRoot, { action: 'stage', path: '--literal.txt' });
	expect(
		(await projectRepository(projectRoot)).changes.find(({ path }) => path === '--literal.txt')
			?.index
	).toBe('A');
	await projectRepositoryAction(projectRoot, { action: 'unstage', path: '--literal.txt' });
	expect(
		(await projectRepository(projectRoot)).changes.find(({ path }) => path === '--literal.txt')
			?.index
	).toBe('?');
	await projectRepositoryAction(projectRoot, { action: 'stageAll' });
	await projectRepositoryAction(projectRoot, { action: 'commit', message: 'Commit from HUE' });

	expect((await projectRepository(projectRoot)).changes).toEqual([]);
	expect(
		Bun.spawnSync(['git', 'log', '-1', '--pretty=%s'], { cwd: projectRoot })
			.stdout.toString()
			.trim()
	).toBe('Commit from HUE');
});

test('reads only the bounded staged diff for commit generation', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-staged-diff-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'staged.txt'), 'staged content\n');
	writeFileSync(join(projectRoot, 'unstaged.txt'), 'unstaged content\n');
	Bun.spawnSync(['git', 'add', 'staged.txt'], { cwd: projectRoot });

	const diff = await projectStagedDiff(projectRoot);
	expect(diff).toContain('staged content');
	expect(diff).not.toContain('unstaged content');
});

test('reads staged, unstaged, and branch diffs without mixing scopes', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-diff-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'base\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'switch', '-c', 'feature'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'branch.txt'), 'branch content\n');
	Bun.spawnSync(['git', 'add', 'branch.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Branch'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'staged.txt'), 'index only\n');
	Bun.spawnSync(['git', 'add', 'staged.txt'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'worktree only\n');

	const staged = await projectRepositoryDiff(projectRoot, { scope: 'staged' });
	const unstaged = await projectRepositoryDiff(projectRoot, { scope: 'unstaged' });
	const branch = await projectRepositoryDiff(projectRoot, { scope: 'branch', base: 'main' });

	expect(staged.diff).toContain('index only');
	expect(staged.diff).not.toContain('worktree only');
	expect(unstaged.diff).toContain('worktree only');
	expect(unstaged.diff).not.toContain('index only');
	expect(branch).toEqual(
		expect.objectContaining({ scope: 'branch', base: 'main', truncated: false })
	);
	expect(branch.diff).toContain('branch content');
	expect(branch.diff).not.toContain('index only');
});

test('exposes staged and unstaged deleted files only through validated diff paths', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-deleted-diff-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'staged.txt'), 'staged deletion\n');
	writeFileSync(join(projectRoot, 'unstaged.txt'), 'unstaged deletion\n');
	Bun.spawnSync(['git', 'add', '.'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	rmSync(join(projectRoot, 'staged.txt'));
	rmSync(join(projectRoot, 'unstaged.txt'));
	Bun.spawnSync(['git', 'add', 'staged.txt'], { cwd: projectRoot });

	expect((await projectRepository(projectRoot)).changes).toEqual([
		{
			path: 'staged.txt',
			index: 'D',
			worktree: ' ',
			fileUrl: null,
			diffUrl: 'staged.txt'
		},
		{
			path: 'unstaged.txt',
			index: ' ',
			worktree: 'D',
			fileUrl: null,
			diffUrl: 'unstaged.txt'
		}
	]);
	expect(
		(await projectRepositoryDiff(projectRoot, { scope: 'staged', file: 'staged.txt' })).diff
	).toContain('-staged deletion');
	expect(
		(await projectRepositoryDiff(projectRoot, { scope: 'unstaged', file: 'unstaged.txt' })).diff
	).toContain('-unstaged deletion');
});

test('reports untracked paths that Git diff cannot include', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-untracked-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, '--literal.txt'), 'not in Git diff\n');
	writeFileSync(join(projectRoot, 'other.txt'), 'also untracked\n');

	const result = await projectRepositoryDiff(projectRoot, {
		scope: 'unstaged',
		file: '--literal.txt'
	});

	expect(result.diff).toBe('');
	expect(result.untrackedPaths).toEqual(['--literal.txt']);
	expect(result.untrackedPathsTruncated).toBe(false);
});

test('treats Git pathspec magic as a literal diff filename', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-literal-pathspec-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, ':(glob)*.txt'), 'base\n');
	writeFileSync(join(projectRoot, 'other.txt'), 'base\n');
	Bun.spawnSync(['git', 'add', '--all'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, ':(glob)*.txt'), 'magic changed\n');
	writeFileSync(join(projectRoot, 'other.txt'), 'other changed\n');

	const tracked = await projectRepositoryDiff(projectRoot, {
		scope: 'unstaged',
		file: ':(glob)*.txt'
	});
	expect(tracked.diff).toContain('magic changed');
	expect(tracked.diff).not.toContain('other changed');

	writeFileSync(join(projectRoot, ':(glob)*.log'), 'magic untracked\n');
	writeFileSync(join(projectRoot, 'other.log'), 'other untracked\n');
	const untracked = await projectRepositoryDiff(projectRoot, {
		scope: 'unstaged',
		file: ':(glob)*.log'
	});
	expect(untracked.untrackedPaths).toEqual([':(glob)*.log']);
});

test('rejects control characters in repository diff filenames', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-control-path-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });

	await expect(
		projectRepositoryDiff(projectRoot, { scope: 'unstaged', file: 'bad\nname.txt' })
	).rejects.toThrow('Invalid diff file');
});

test('only queries untracked paths for unstaged diffs', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-untracked-scope-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'base\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'switch', '-c', 'feature'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'untracked.txt'), 'not part of staged or branch diffs\n');

	for (const options of [
		{ scope: 'staged' as const, maxBytes: 1 },
		{ scope: 'branch' as const, base: 'main', maxBytes: 1 }
	]) {
		const result = await projectRepositoryDiff(projectRoot, options);
		expect(result.maxBytes).toBe(1);
		expect(result.untrackedPaths).toEqual([]);
		expect(result.untrackedPathsTruncated).toBe(false);
	}
});

test('resolves a branch diff base and rejects invalid refs', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-base-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.name', 'HUE Test'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'config', 'user.email', 'hue@example.test'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'tracked.txt'), 'base\n');
	Bun.spawnSync(['git', 'add', 'tracked.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'switch', '-c', 'feature'], { cwd: projectRoot });

	expect((await projectRepositoryDiff(projectRoot, { scope: 'branch' })).base).toBe('main');
	expect(
		(await projectRepositoryDiff(projectRoot, { scope: 'branch', base: 'feature' })).base
	).toBe('feature');
	await expect(
		projectRepositoryDiff(projectRoot, { scope: 'branch', base: '--output=/tmp/hue' })
	).rejects.toThrow('Invalid base ref');
	await expect(
		projectRepositoryDiff(projectRoot, { scope: 'branch', base: 'missing' })
	).rejects.toThrow('Base ref was not found');
});

test('caps repository diff output and reports truncation', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-cap-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'large.txt'), `${'old\n'.repeat(80)}`);
	Bun.spawnSync(['git', 'add', 'large.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'large.txt'), `${'changed content\n'.repeat(80)}`);

	const result = await projectRepositoryDiff(projectRoot, { scope: 'unstaged', maxBytes: 180 });
	expect(Buffer.byteLength(result.diff)).toBeLessThanOrEqual(180);
	expect(result.truncated).toBe(true);
	expect(result.maxBytes).toBe(180);
});

test('returns a truncated diff when Git output exceeds the process buffer default', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-review-large-cap-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'large.txt'), 'old content\n'.repeat(75_000));
	Bun.spawnSync(['git', 'add', 'large.txt'], { cwd: projectRoot });
	Bun.spawnSync(['git', 'commit', '-m', 'Initial'], { cwd: projectRoot });
	writeFileSync(join(projectRoot, 'large.txt'), 'new content\n'.repeat(75_000));

	const result = await projectRepositoryDiff(projectRoot, { scope: 'unstaged' });

	expect(Buffer.byteLength(result.diff)).toBeLessThanOrEqual(100_000);
	expect(result.truncated).toBe(true);
	expect(result.maxBytes).toBe(100_000);
});

test('pushes the current branch and creates its upstream', async () => {
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

	await projectRepositoryAction(projectRoot, { action: 'push' });

	expect(
		Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: projectRoot })
			.stdout.toString()
			.trim()
	).toBe('origin/main');
});

test('rejects unknown repository mutations', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-invalid-action-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: projectRoot });

	await expect(
		projectRepositoryAction(projectRoot, { action: 'destroy' } as never)
	).rejects.toThrow('Unknown Git action');
});
