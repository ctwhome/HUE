import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HermesACP } from './hermes-acp';
import type { HermesSession } from './hermes-acp';
import { ExternalCronService } from './external-cron-service';
import { redactHermesValue } from './redaction';
import { resolveHermesCommand } from './hermes-cli';
import { HermesServe } from './hermes-serve';
import { HermesBundles } from './hermes-bundles';
import { hermesSkillAccessInventory, hermesSkillsRoot } from './hermes-skills';
import { HermesProjects, type HermesProject } from './hermes-projects';
import { MessageDispatcher } from './message-dispatcher';
import { ProjectTerminals, resolveTerminalShell } from './project-terminals';
import { ProjectFiles } from './project-files';
import { HUEStore } from './store';
import { reconcileLegacyProjects } from './project-reconciliation';
import { ProjectOperations } from './project-operations';
import { NotificationService, notificationOptionsFromEnv } from './notifications';
import { ScheduleService } from './schedule-service';

type HUEServices = {
	store: HUEStore;
	runtime: HermesACP;
	admin: HermesServe;
	bundles: HermesBundles;
	projects: HermesProjects;
	dispatcher: MessageDispatcher;
	notifications: NotificationService;
	schedules: ScheduleService;
	externalCron: ExternalCronService;
	terminals: ProjectTerminals;
	projectOperations: ProjectOperations<HermesProject>;
};

const globalServices = globalThis as typeof globalThis & {
	__hueServices?: HUEServices;
	__hueShutdown?: Promise<void>;
};

function createServices(): HUEServices {
	const databasePath = process.env.HUE_DATABASE_PATH ?? join(homedir(), '.hue', 'hue.db');
	if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
	const store = new HUEStore(databasePath);
	const hermesCommand = resolveHermesCommand();
	const profile = process.env.HUE_HERMES_PROFILE ?? 'default';
	const runtime = new HermesACP({
		command: hermesCommand,
		profile,
		onSessionInfo: (sessionId, update) => {
			if (update.title === undefined) return;
			try {
				store.applyRuntimeSessionTitle(sessionId, update.title);
			} catch (cause) {
				console.error(
					`[hermes-acp] Ignored invalid Session title: ${String(redactHermesValue(cause))}`
				);
			}
		},
		onDiagnostic: (message) => console.error(`[hermes-acp] ${String(redactHermesValue(message))}`)
	});
	const admin = new HermesServe({
		command: hermesCommand,
		profile,
		onDiagnostic: (message) => console.error(`[hermes-admin] ${String(redactHermesValue(message))}`)
	});
	const projects = new HermesProjects(
		{ request: (method, params) => admin.rpc(method, params) },
		profile
	);
	const bundles = new HermesBundles(
		{ request: (method, params) => admin.rpc(method, params) },
		profile,
		() => admin.json<unknown[]>('/api/skills'),
		() => hermesSkillAccessInventory(hermesSkillsRoot(profile))
	);
	const projectOperations = new ProjectOperations<HermesProject>({
		resolve: (reference) => projects.get(reference),
		active: (projectId) => store.hasActiveProjectDeliveries(projectId),
		archive: (projectId) => projects.archive(projectId)
	});
	const notifications = new NotificationService(store, notificationOptionsFromEnv(process.env));
	const dispatcher = new MessageDispatcher(store, runtime, () => notifications.deliverPending());
	const schedules = new ScheduleService({
		store,
		runtime,
		dispatcher,
		root: unprojectedSessionRoot
	});
	const externalCron = new ExternalCronService({
		store,
		transport: admin,
		onAttention: () => notifications.deliverPending()
	});
	return {
		store,
		runtime,
		admin,
		bundles,
		projects,
		dispatcher,
		notifications,
		schedules,
		externalCron,
		terminals: new ProjectTerminals(),
		projectOperations
	};
}

export function services(): HUEServices {
	if (
		!(globalServices.__hueServices?.store instanceof HUEStore) ||
		!(globalServices.__hueServices?.schedules instanceof ScheduleService) ||
		!(globalServices.__hueServices?.externalCron instanceof ExternalCronService)
	) {
		globalServices.__hueServices = createServices();
	}
	return globalServices.__hueServices;
}

export function shutdownServices(): Promise<void> {
	if (globalServices.__hueShutdown) return globalServices.__hueShutdown;
	const state = globalServices.__hueServices;
	if (!state) return Promise.resolve();
	globalServices.__hueShutdown = (async () => {
		state.terminals.dispose();
		state.schedules.close();
		await state.externalCron?.close();
		const dispatcherDrain = state.dispatcher.close();
		const notificationDrain = state.notifications.close();
		await Promise.all([state.runtime.close(), state.admin.close()]);
		await Promise.all([dispatcherDrain, notificationDrain]);
		state.store.close();
	})();
	return globalServices.__hueShutdown;
}

export function unprojectedSessionRoot(): string {
	const root = join(homedir(), '.hue', 'sessions');
	mkdirSync(root, { recursive: true });
	return realpathSync(root);
}

export function quickAskSessionRoot(): string {
	const root = join(unprojectedSessionRoot(), '.quick-ask');
	mkdirSync(root, { recursive: true });
	return realpathSync(root);
}

export function trustedProjectRoot(input: string): string {
	const candidate = input.trim();
	if (!candidate || !isAbsolute(candidate)) {
		throw new Error('Project root must be an absolute path');
	}
	const canonical = resolve(candidate);
	let stat;
	try {
		stat = statSync(canonical);
	} catch {
		throw new Error('Project root does not exist');
	}
	if (!stat.isDirectory()) throw new Error('Project root must be a directory');
	realpathSync(canonical);
	return canonical;
}

export type ProjectView = {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
	group: string | null;
	primaryPath: string;
	folders: Array<{ path: string; label: string | null; isPrimary: boolean; available: boolean }>;
	rootAvailable: boolean;
	sessionCount: number;
	runningCount: number;
	attentionCount: number;
	unreadCount: number;
};

function directoryAvailable(path: string) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function projectView(
	project: HermesProject,
	color: string | null = null,
	group: string | null = null,
	sessionCount = 0,
	indicators = { running: 0, attention: 0, unread: 0 }
): ProjectView {
	return {
		id: project.id,
		name: project.name,
		icon: project.icon,
		color,
		group,
		primaryPath: project.primary_path,
		folders: project.folders.map((folder) => ({
			path: folder.path,
			label: folder.label,
			isPrimary: folder.is_primary,
			available: directoryAvailable(folder.path)
		})),
		rootAvailable: directoryAvailable(project.primary_path),
		sessionCount,
		runningCount: indicators.running,
		attentionCount: indicators.attention,
		unreadCount: indicators.unread
	};
}

export async function loadProjectViews() {
	const state = services();
	const reconciled = await reconcileLegacyProjects(state.store, state.projects);
	return {
		projects: reconciled.projects
			.filter((project) => !project.archived)
			.map((project) =>
				projectView(
					project,
					state.store.getProjectColor(project.id),
					state.store.getProjectGroup(project.id),
					state.store.countSessions(project.id),
					state.store.getSessionIndicatorCounts(project.id)
				)
			),
		chatSessionCount: state.store.countSessions(null, 'unscheduled'),
		chatIndicators: state.store.getSessionIndicatorCounts(null, 'unscheduled'),
		cronSessionCount: state.store.countSessions(null, 'scheduled'),
		reconciliationIssues: reconciled.issues
	};
}

export async function authoritativeProject(id: string): Promise<HermesProject> {
	const project = await services().projects.get(id);
	if (project.archived) throw new Error('Project not found');
	services().store.ensureProjectMetadata(project.id, project.name);
	return project;
}

export function mergeProjectSessionViews(
	runtimeSessions: HermesSession[],
	storedSessions: Array<{ sessionId: string; cwd: string; icon: string | null }>,
	availableRoots: ReadonlySet<string> = new Set(runtimeSessions.map(({ cwd }) => cwd))
) {
	const runtimeIds = new Set(runtimeSessions.map(({ sessionId }) => sessionId));
	const storedById = new Map(storedSessions.map((session) => [session.sessionId, session]));
	return [
		...runtimeSessions.map((session) => {
			const customIcon = storedById.get(session.sessionId)?.icon ?? null;
			return { ...session, customIcon, available: true, recovery: null };
		}),
		...storedSessions
			.filter(({ sessionId }) => !runtimeIds.has(sessionId))
			.map((session) => {
				const available = availableRoots.has(session.cwd);
				return {
					...session,
					title: available ? 'Untitled Hermes Session' : 'Unavailable Hermes Session',
					customIcon: session.icon,
					updatedAt: null,
					available,
					recovery: available ? null : `Restore the Session folder at ${session.cwd} to resume it.`
				};
			})
	];
}

export type RuntimeHealthCheck = {
	id: 'project' | 'git' | 'terminal' | 'preview' | 'acp' | 'admin';
	label: string;
	status: 'ready' | 'idle' | 'blocked' | 'unavailable';
	summary: string;
	action: string;
};

export function projectRuntimeHealth(
	projectRoot: string,
	runtime: { acp: 'idle' | 'ready' | 'unavailable'; admin: 'idle' | 'ready' | 'unavailable' }
): RuntimeHealthCheck[] {
	let rootReady = false;
	try {
		rootReady = statSync(projectRoot).isDirectory();
	} catch {
		// Missing roots are normal recoverable persisted state.
	}
	let repository = false;
	if (rootReady) repository = projectRepository(projectRoot).isRepository;
	let shellReady = false;
	if (rootReady) {
		try {
			resolveTerminalShell();
			shellReady = true;
		} catch {
			// Action is returned below without leaking machine paths.
		}
	}
	const runtimeCheck = (
		id: 'acp' | 'admin',
		label: string,
		status: 'idle' | 'ready' | 'unavailable',
		idleAction: string
	): RuntimeHealthCheck => ({
		id,
		label,
		status,
		summary: status === 'ready' ? 'Ready' : status === 'idle' ? 'Not started' : 'Unavailable',
		action: status === 'ready' ? 'No action needed' : idleAction
	});
	return [
		{
			id: 'project',
			label: 'Project',
			status: rootReady ? 'ready' : 'unavailable',
			summary: rootReady ? 'Folder available' : 'Folder not found',
			action: rootReady ? 'No action needed' : 'Locate or remove Project'
		},
		{
			id: 'git',
			label: 'Git',
			status: !rootReady ? 'blocked' : repository ? 'ready' : 'idle',
			summary: !rootReady
				? 'Project folder unavailable'
				: repository
					? 'Repository ready'
					: 'Not a Git repository',
			action: !rootReady
				? 'Recover Project folder first'
				: repository
					? 'No action needed'
					: 'Initialize Git only if needed'
		},
		{
			id: 'terminal',
			label: 'Terminal',
			status: !rootReady ? 'blocked' : shellReady ? 'ready' : 'unavailable',
			summary: !rootReady
				? 'Project folder unavailable'
				: shellReady
					? 'Shell available'
					: 'No executable shell found',
			action: !rootReady
				? 'Recover Project folder first'
				: shellReady
					? 'No action needed'
					: 'Set SHELL to an executable path'
		},
		{
			id: 'preview',
			label: 'Preview',
			status: rootReady ? 'idle' : 'blocked',
			summary: rootReady ? 'Browser-owned state' : 'Project folder unavailable',
			action: rootReady ? 'Check saved preview in Browser panel' : 'Recover Project folder first'
		},
		runtimeCheck('acp', 'Hermes ACP', runtime.acp, 'Start or open a Session'),
		runtimeCheck('admin', 'Hermes admin', runtime.admin, 'Open Hermes settings')
	];
}

export function sessionMatchesProjectRoot(projectRoot: string, sessionCwd: string): boolean {
	try {
		return realpathSync(projectRoot) === realpathSync(sessionCwd);
	} catch {
		return false;
	}
}

export function sessionMatchesProjectFolders(
	projectFolders: string[],
	sessionCwd: string
): boolean {
	let cwd: string;
	try {
		cwd = realpathSync(sessionCwd);
	} catch {
		return false;
	}
	return projectFolders.some((folder) => {
		try {
			const difference = relative(realpathSync(folder), cwd);
			return (
				!isAbsolute(difference) &&
				(difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`)))
			);
		} catch {
			return false;
		}
	});
}

export function projectBranch(projectRoot: string): string | null {
	const result = spawnSync('git', ['-C', projectRoot, 'branch', '--show-current'], {
		encoding: 'utf8',
		timeout: 2_000
	});
	const branch = result.status === 0 ? result.stdout.trim() : '';
	return branch || null;
}

export type ProjectRepository = {
	isRepository: boolean;
	branch: string | null;
	changes: Array<{
		path: string;
		index: string;
		worktree: string;
		fileUrl: string | null;
		diffUrl?: string;
	}>;
	worktrees: Array<{ path: string; branch: string | null; head: string }>;
	remotes: Array<{ name: string; webUrl: string | null }>;
};

export type ProjectRepositoryAction =
	| { action: 'stage' | 'unstage'; path: string }
	| { action: 'stageAll' | 'unstageAll' | 'push' }
	| { action: 'commit'; message: string };

const GENERATED_DIRECTORIES = new Set([
	'node_modules',
	'build',
	'dist',
	'.svelte-kit',
	'.next',
	'coverage',
	'target'
]);

export function projectRepositories(
	projectRoot: string,
	limits: { maxDepth?: number; maxDirectories?: number } = {}
): Array<{ path: string }> {
	const root = realpathSync(projectRoot);
	const repositories: Array<{ path: string }> = [];
	const maxDepth = Math.max(0, Math.trunc(limits.maxDepth ?? 8));
	const maxDirectories = Math.max(1, Math.trunc(limits.maxDirectories ?? 10_000));
	const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
	for (let index = 0; index < pending.length && index < maxDirectories; index += 1) {
		const { directory, depth } = pending[index]!;
		try {
			if (
				statSync(join(directory, '.git')).isDirectory() ||
				statSync(join(directory, '.git')).isFile()
			) {
				const path = relative(root, directory);
				repositories.push({ path: path ? path.split(sep).join('/') : '.' });
			}
		} catch {
			// Not a Git working tree.
		}
		if (depth >= maxDepth) continue;
		try {
			const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
				left.name.localeCompare(right.name)
			);
			for (const entry of entries) {
				if (
					entry.isDirectory() &&
					entry.name !== '.git' &&
					!GENERATED_DIRECTORIES.has(entry.name)
				) {
					pending.push({ directory: join(directory, entry.name), depth: depth + 1 });
				}
			}
		} catch {
			// Unreadable folders cannot contain a usable project repository.
		}
	}
	return repositories.sort(({ path: left }, { path: right }) =>
		left === '.' ? -1 : right === '.' ? 1 : left.localeCompare(right)
	);
}

export function resolveProjectRepository(
	projectRoot: string,
	selected?: string,
	repositories = projectRepositories(projectRoot)
): string {
	const path = selected ?? repositories[0]?.path;
	if (!path) return realpathSync(projectRoot);
	if (!repositories.some((repository) => repository.path === path)) {
		throw new Error('Repository is not part of this project');
	}
	return realpathSync(path === '.' ? projectRoot : join(projectRoot, path));
}

export type ProjectGitHubItem = { number: number; title: string; url: string };
export type ProjectGitHubIssueGroup = { milestone: string | null; issues: ProjectGitHubItem[] };
type CommandRunner = (
	command: string,
	args: string[],
	options?: { cwd?: string; encoding?: BufferEncoding; timeout?: number }
) => { status: number | null; stdout: string | Buffer };

export function projectGitHubItems(
	projectRoot: string,
	run: CommandRunner = (command, args, options) => spawnSync(command, args, options)
): { issueGroups: ProjectGitHubIssueGroup[]; pullRequests: ProjectGitHubItem[] } {
	const origin = run('git', ['-C', projectRoot, 'remote', 'get-url', 'origin'], {
		encoding: 'utf8',
		timeout: 2_000
	});
	if (origin.status !== 0) throw new Error('Git origin is not configured');
	const webUrl = repositoryWebUrl(origin.stdout.toString().trim());
	if (!webUrl || new URL(webUrl).hostname !== 'github.com') {
		throw new Error('Git origin is not hosted on GitHub');
	}
	const list = (kind: 'issue' | 'pr', fields: string) => {
		const result = run(
			'gh',
			[kind, 'list', '--repo', webUrl, '--state', 'open', '--limit', '20', '--json', fields],
			{ cwd: projectRoot, encoding: 'utf8', timeout: 10_000 }
		);
		if (result.status !== 0)
			throw new Error(`GitHub CLI could not list ${kind === 'issue' ? 'issues' : 'pull requests'}`);
		return JSON.parse(result.stdout.toString()) as unknown[];
	};
	const issueGroups = new Map<string | null, ProjectGitHubItem[]>();
	for (const { milestone, ...issue } of list('issue', 'number,title,url,milestone') as Array<
		ProjectGitHubItem & { milestone: { title: string } | null }
	>) {
		const title = milestone?.title ?? null;
		issueGroups.set(title, [...(issueGroups.get(title) ?? []), issue]);
	}
	return {
		issueGroups: [...issueGroups].map(([milestone, issues]) => ({ milestone, issues })),
		pullRequests: list('pr', 'number,title,url') as ProjectGitHubItem[]
	};
}

function git(projectRoot: string, args: string[], allowFailure = false): string | null {
	const result = spawnSync('git', ['-C', projectRoot, ...args], {
		encoding: 'utf8',
		timeout: 2_000
	});
	if (result.status === 0) return result.stdout;
	if (allowFailure) return null;
	throw new Error(`Git ${args[0]} failed`);
}

function repositoryWebUrl(remote: string): string | null {
	const ssh = remote.match(/^git@([^:]+):(.+)$/);
	if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, '')}`;
	try {
		const url = new URL(remote);
		if (url.protocol === 'ssh:') {
			return `https://${url.hostname}/${url.pathname.replace(/^\//, '').replace(/\.git$/, '')}`;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url
			.toString()
			.replace(/\/$/, '')
			.replace(/\.git$/, '');
	} catch {
		return null;
	}
}

export function projectRepository(projectRoot: string): ProjectRepository {
	if (git(projectRoot, ['rev-parse', '--is-inside-work-tree'], true)?.trim() !== 'true') {
		return { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] };
	}

	const statusEntries = git(projectRoot, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all'
	])!
		.split('\0')
		.filter(Boolean);
	const changes: ProjectRepository['changes'] = [];
	const projectFiles = new ProjectFiles(projectRoot);
	for (let index = 0; index < statusEntries.length; index += 1) {
		const entry = statusEntries[index];
		const path = entry.slice(3);
		let fileUrl: string | null = null;
		try {
			projectFiles.validateFile(path);
			fileUrl = path;
		} catch {
			// Tool output becomes clickable only after descriptor-safe server validation.
		}
		changes.push({
			path,
			index: entry[0],
			worktree: entry[1],
			fileUrl,
			...((entry[0] === 'D' || entry[1] === 'D') && validDiffFile(path) ? { diffUrl: path } : {})
		});
		if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') index += 1;
	}
	changes.sort((left, right) => left.path.localeCompare(right.path));

	const worktrees = (git(projectRoot, ['worktree', 'list', '--porcelain']) ?? '')
		.trim()
		.split(/\n\n+/)
		.filter(Boolean)
		.map((block) => {
			const values = new Map(
				block.split('\n').map((line) => {
					const separator = line.indexOf(' ');
					return separator === -1
						? [line, '']
						: [line.slice(0, separator), line.slice(separator + 1)];
				})
			);
			return {
				path: values.get('worktree') ?? '',
				branch: values.get('branch')?.replace('refs/heads/', '') ?? null,
				head: values.get('HEAD') ?? ''
			};
		});

	const remotes = (git(projectRoot, ['remote']) ?? '')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((name) => ({
			name,
			webUrl: repositoryWebUrl(git(projectRoot, ['remote', 'get-url', name])!.trim())
		}));

	return { isRepository: true, branch: projectBranch(projectRoot), changes, worktrees, remotes };
}

export function projectStagedDiff(projectRoot: string) {
	const diff = git(projectRoot, [
		'diff',
		'--cached',
		'--no-ext-diff',
		'--no-color',
		'--unified=3'
	])?.trim();
	if (!diff) throw new Error('Stage files before generating a commit message');
	return diff.slice(0, 100_000);
}

export type ProjectRepositoryDiffScope = 'staged' | 'unstaged' | 'branch';
export type ProjectRepositoryDiff = {
	scope: ProjectRepositoryDiffScope;
	base: string | null;
	diff: string;
	truncated: boolean;
	maxBytes: number;
	untrackedPaths: string[];
	untrackedPathsTruncated: boolean;
};

function validBaseRef(base: string) {
	return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(base);
}

function validDiffFile(file: string) {
	return Boolean(
		file &&
		!isAbsolute(file) &&
		!file.includes('\\') &&
		!/[\0-\x1f\x7f]/.test(file) &&
		!file.split('/').some((part) => !part || part === '.' || part === '..')
	);
}

function branchDiffBase(projectRoot: string, supplied?: string) {
	if (supplied && !validBaseRef(supplied)) throw new Error('Invalid base ref');
	const current = projectBranch(projectRoot);
	const upstream = git(projectRoot, ['rev-parse', '--abbrev-ref', '@{upstream}'], true)?.trim();
	const candidates = supplied ? [supplied] : [upstream, 'main', 'master'].filter(Boolean);
	for (const candidate of candidates) {
		if (!supplied && candidate === current) continue;
		if (
			git(
				projectRoot,
				['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`],
				true
			)
		) {
			return candidate!;
		}
	}
	if (supplied) throw new Error('Base ref was not found');
	throw new Error('Could not resolve a base ref');
}

export function projectRepositoryDiff(
	projectRoot: string,
	options: {
		scope: ProjectRepositoryDiffScope;
		base?: string;
		file?: string;
		maxBytes?: number;
	}
): ProjectRepositoryDiff {
	if (git(projectRoot, ['rev-parse', '--is-inside-work-tree'], true)?.trim() !== 'true') {
		throw new Error('Selected folder is not a Git repository');
	}
	if (!['staged', 'unstaged', 'branch'].includes(options.scope))
		throw new Error('Invalid diff scope');
	if (options.file && !validDiffFile(options.file)) {
		throw new Error('Invalid diff file');
	}

	const base = options.scope === 'branch' ? branchDiffBase(projectRoot, options.base) : null;
	const args = ['diff'];
	if (options.scope === 'staged') args.push('--cached');
	if (base) args.push(`${base}...HEAD`);
	args.push('--no-ext-diff', '--no-color', '--unified=3');
	if (options.file) args.push('--', options.file);
	const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 100_000, 100_000));
	let untrackedPaths: string[] = [];
	let untrackedPathsTruncated = false;
	if (options.scope === 'unstaged') {
		const untrackedArgs = ['ls-files', '--others', '--exclude-standard', '-z'];
		if (options.file) untrackedArgs.push('--', options.file);
		const untrackedResult = spawnSync(
			'git',
			['--literal-pathspecs', '-C', projectRoot, ...untrackedArgs],
			{
				timeout: 10_000,
				maxBuffer: maxBytes + 1
			}
		);
		const untrackedOutput = Buffer.isBuffer(untrackedResult.stdout)
			? untrackedResult.stdout
			: Buffer.from(untrackedResult.stdout);
		const untrackedOverflowed =
			(untrackedResult.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS' &&
			untrackedOutput.byteLength > maxBytes;
		if (!untrackedOverflowed && (untrackedResult.error || untrackedResult.status !== 0)) {
			throw new Error('Git untracked file listing failed');
		}
		untrackedPathsTruncated = untrackedOverflowed || untrackedOutput.byteLength > maxBytes;
		const boundedUntrackedOutput = untrackedOutput.subarray(0, maxBytes);
		untrackedPaths = boundedUntrackedOutput.toString('utf8').split('\0');
		if (untrackedPathsTruncated && boundedUntrackedOutput.at(-1) !== 0) {
			untrackedPaths.pop();
		}
		if (untrackedPaths.at(-1) === '') untrackedPaths.pop();
	}
	const result = spawnSync('git', ['--literal-pathspecs', '-C', projectRoot, ...args], {
		timeout: 10_000,
		maxBuffer: maxBytes + 1
	});
	const output = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
	const overflowed =
		(result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS' &&
		output.byteLength > maxBytes;
	if (!overflowed && (result.error || result.status !== 0)) throw new Error('Git diff failed');
	const truncated = overflowed || output.byteLength > maxBytes;
	let diff = output.subarray(0, maxBytes).toString('utf8');
	while (Buffer.byteLength(diff) > maxBytes) diff = diff.slice(0, -1);
	return {
		scope: options.scope,
		base,
		diff,
		truncated,
		maxBytes,
		untrackedPaths,
		untrackedPathsTruncated
	};
}

export function projectRepositoryAction(
	projectRoot: string,
	operation: ProjectRepositoryAction
): ProjectRepository {
	let args: string[];
	if (operation.action === 'stage') {
		if (!operation.path) throw new Error('File path is required');
		args = ['add', '--', operation.path];
	} else if (operation.action === 'unstage') {
		if (!operation.path) throw new Error('File path is required');
		args = ['restore', '--staged', '--', operation.path];
	} else if (operation.action === 'stageAll') {
		args = ['add', '--all'];
	} else if (operation.action === 'unstageAll') {
		args = ['reset', '--mixed'];
	} else if (operation.action === 'commit') {
		const message = operation.message.trim();
		if (!message) throw new Error('Commit message is required');
		if (message.length > 5_000) throw new Error('Commit message is too long');
		args = ['commit', '-m', message];
	} else if (operation.action === 'push') {
		const upstream = git(projectRoot, ['rev-parse', '--abbrev-ref', '@{upstream}'], true)?.trim();
		if (upstream) {
			args = ['push'];
		} else {
			const remote = git(projectRoot, ['remote'])?.trim().split('\n')[0];
			const branch = projectBranch(projectRoot);
			if (!remote) throw new Error('No Git remote is configured');
			if (!branch) throw new Error('Cannot push a detached HEAD');
			args = ['push', '--set-upstream', remote, branch];
		}
	} else {
		throw new Error('Unknown Git action');
	}

	const result = spawnSync('git', ['-C', projectRoot, ...args], {
		encoding: 'utf8',
		timeout: operation.action === 'push' ? 60_000 : 15_000
	});
	if (result.status !== 0) throw new Error(`Git ${operation.action} failed`);
	return projectRepository(projectRoot);
}
