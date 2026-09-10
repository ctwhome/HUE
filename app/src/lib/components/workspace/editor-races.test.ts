import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DirtyGuard } from './dirty-guard';

// Execute the actual component handlers without a browser; DOM interaction stays in e2e.
function handlers(
	file: string,
	expose: string,
	props: Record<string, unknown> = {},
	dependencies: Record<string, unknown> = {}
) {
	const source = readFileSync(new URL(file, import.meta.url), 'utf8')
		.split('<script lang="ts">')[1]!
		.split('</script>')[0]!
		.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
		.replace(/export /g, '');
	const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
		`${source}\nreturn { ${expose} };`
	);
	const env = {
		$state: (v: unknown) => v,
		$derived: (v: unknown) => v,
		$bindable: () => undefined,
		$props: () => props,
		$effect: () => {},
		untrack: (fn: () => unknown) => fn(),
		onDestroy() {},
		onMount() {},
		tick: async () => {},
		groupPromptCatalog: () => [],
		DirtyGuard,
		...dependencies
	};
	return new Function(...Object.keys(env), code)(...Object.values(env));
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>((done) => {
			resolve = done;
		}),
		resolve: (value: T) => resolve(value)
	};
}

const cronJob = { profile: 'default', profileName: 'Default', jobId: 'daily', name: 'Daily', prompt: 'A', schedule: '0 8 * * *', deliver: 'local', model: '', provider: '', enabled: true };
const cronExpose = `save, toggleEnabled, remove, openRun, loadDetail,
	get content() { return prompt; }, set content(v) { prompt = v; }, get saved() { return saved && !hasUnsavedChanges(); },
	get messages() { return messages; }, get busy() { return saving; }, get dirty() { return hasUnsavedChanges(); },
	init() { loadedKey = JSON.stringify([job.profile, job.jobId]); detail = job; name = job.name; prompt = job.prompt; schedule = job.schedule; deliver = job.deliver; model = job.model; provider = job.provider; loading = false; },
	switchJob() { job = { ...job, jobId: 'other' }; loadedKey = JSON.stringify([job.profile, job.jobId]); }`;

test('external cron settings save locks repeats and preserves newer dirty typing', async () => {
	const response = deferred<unknown>(); let calls = 0;
	const state = handlers('./ExternalCronJobView.svelte', cronExpose, { job: cronJob, onupdated() {} },
		{ workspaceApi: () => { calls++; return response.promise; } });
	state.init(); const saving = state.save({ preventDefault() {} });
	void state.save({ preventDefault() {} }); expect(calls).toBe(1);
	state.content = 'Newer'; response.resolve({ job: cronJob }); await saving;
	expect(state.content).toBe('Newer'); expect(state.dirty).toBe(true); expect(state.saved).toBe(false); expect(state.busy).toBe(false);
});

test('external cron saves never call parent updates for a later job', async () => {
	const response = deferred<unknown>(); let updates = 0;
	const state = handlers('./ExternalCronJobView.svelte', cronExpose, { job: cronJob, onupdated() { updates++; } }, { workspaceApi: () => response.promise });
	state.init(); const saving = state.save({ preventDefault() {} }); state.switchJob();
	response.resolve({ job: cronJob }); await saving;
	expect(updates).toBe(0);
});

test('external cron transcript ignores A-to-B-to-A stale responses', async () => {
	const responses = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()]; let call = 0;
	const state = handlers('./ExternalCronJobView.svelte', cronExpose, { job: cronJob, onread() {} }, { workspaceApi: () => responses[call++]!.promise });
	state.init();
	const first = state.openRun({ sessionId: 'a', readAt: 'read' }, false);
	const second = state.openRun({ sessionId: 'b', readAt: 'read' }, false);
	const third = state.openRun({ sessionId: 'a', readAt: 'read' }, false);
	responses[2]!.resolve({ messages: [{ text: 'Newest' }] }); await third;
	responses[1]!.resolve({ messages: [{ text: 'B' }] }); await second;
	responses[0]!.resolve({ messages: [{ text: 'Stale' }] }); await first;
	expect(state.messages).toEqual([{ text: 'Newest' }]);
});

test('external cron refresh retains known runs on failure and exposes a retryable local error', async () => {
	const response = deferred<unknown>(); let calls = 0;
	const state = handlers('./ExternalCronJobView.svelte', `${cronExpose}, refreshRuns, get runs() { return runs; }, get runsError() { return runsError; }, get runsLoading() { return runsLoading; }, seedRuns() { runs = [{ sessionId: 'known' }]; }`,
		{ job: cronJob, onupdated() {} }, { workspaceApi: () => { calls++; return response.promise; } });
	state.init(); state.seedRuns();
	const refresh = state.refreshRuns(); void state.refreshRuns(); expect(calls).toBe(1);
	response.resolve(Promise.reject(new Error('Hermes history unavailable'))); await refresh;
	expect(state.runs).toEqual([{ sessionId: 'known' }]); expect(state.runsError).toContain('unavailable'); expect(state.runsLoading).toBe(false);
});

test('external cron history labels disclose the upstream window without claiming complete history', () => {
	const state = handlers('./ExternalCronJobView.svelte', `coverageLabel, coverage(value) { job = { ...job, history: value }; }`, { job: cronJob });
	expect(state.coverageLabel()).toContain('100');
	expect(state.coverageLabel()).toContain('not reported');
	state.coverage({ limit: 100, possiblyTruncated: true, paginationSupported: false });
	expect(state.coverageLabel()).toContain('100');
	expect(state.coverageLabel()).toContain('no pagination');
	expect(state.coverageLabel()).toContain('may be truncated');
});

test('notification titles use loaded Project names only in-app, preserving API fallback and system privacy', () => {
	const notices: string[] = [];
	const state = handlers('../notifications/AttentionCenter.svelte', 'notificationTitle, present, enable() { foregroundEnabled = true; }',
		{ projects: [{ id: 'p', name: 'Private Project' }] }, {
			attentionState: () => ({}), groupNotifications: () => [], shouldPresentForeground: () => true, shouldPlaySound: () => false,
			document: { visibilityState: 'visible' }, window: { Notification: true }, Notification: class { static permission = 'granted'; constructor(title: string) { notices.push(title); } }
		});
	expect(state.notificationTitle({ projectId: 'p', title: 'Session completed' })).toBe('Private Project · Session completed');
	expect(state.notificationTitle({ projectId: 'missing', title: 'API title', projectName: 'API Project' })).toBe('API Project · API title');
	expect(state.notificationTitle({ projectId: null, title: 'API title' })).toBe('API title');
	state.enable(); state.present({ projectId: 'p', title: 'Session completed' });
	expect(notices).toEqual(['Session completed']);
});

test('runtime logs and update checks are independent, on demand, single-flight and locally fallible', async () => {
	const logs = deferred<Response>();
	const update = deferred<Response>();
	const requests: string[] = [];
	const state = handlers(
		'../HermesPanel.svelte',
		`load, loadRuntimeDetail,
		get details() { return runtimeDetails; }, get data() { return data; }, get loading() { return loading; }, get error() { return error; }`,
		{ dirtyGuard: new DirtyGuard(), view: 'runtime' },
		{
			parseApiResponse: (r: Response) => r.json(),
			fetch: (url: string) => {
				requests.push(url);
				if (url.endsWith('view=logs')) return logs.promise;
				if (url.endsWith('view=update')) return update.promise;
				return Promise.resolve(
					Response.json(
						url === '/api/runtime'
							? { database: { status: 'ready' } }
							: { administration: { health: { ok: true } } }
					)
				);
			}
		}
	);
	await state.load('runtime');
	expect(requests).toEqual(['/api/hermes', '/api/runtime']);
	const pendingLogs = state.loadRuntimeDetail('logs');
	void state.loadRuntimeDetail('logs');
	const pendingUpdate = state.loadRuntimeDetail('update');
	expect(requests).toEqual([
		'/api/hermes',
		'/api/runtime',
		'/api/hermes/admin?view=logs',
		'/api/hermes/admin?view=update'
	]);
	expect(state.loading).toBe(false);
	expect(state.details.logs.loading).toBe(true);
	expect(state.details.update.loading).toBe(true);
	update.resolve(Response.json({ error: 'Update service unavailable' }, { status: 503 }));
	await pendingUpdate;
	expect(state.details.update.error).toBe('Update service unavailable');
	expect(state.details.update.loading).toBe(false);
	expect(state.details.logs.loading).toBe(true);
	expect(state.error).toBe('');
	expect(state.data.administration.health.ok).toBe(true);
	logs.resolve(Response.json({ logs: { lines: [] } }));
	await pendingLogs;
	expect(state.details.logs.value).toEqual({ lines: [] });
	expect(state.details.logs.loading).toBe(false);
});

test('runtime detail failures retain previous results and stale completions cannot replace a later view', async () => {
	const stale = deferred<Response>();
	let call = 0;
	const state = handlers(
		'../HermesPanel.svelte',
		`load, loadRuntimeDetail, get details() { return runtimeDetails; }`,
		{ dirtyGuard: new DirtyGuard(), view: 'runtime' },
		{
			parseApiResponse: (r: Response) => r.json(),
			fetch: () => {
				call++;
				return call === 1
					? Promise.resolve(Response.json({ logs: { lines: ['Retained'] } }))
					: call === 2
						? Promise.resolve(Response.json({ error: 'Refresh failed' }, { status: 503 }))
						: stale.promise;
			}
		}
	);
	await state.loadRuntimeDetail('logs');
	await state.loadRuntimeDetail('logs');
	expect(state.details.logs.value).toEqual({ lines: ['Retained'] });
	expect(state.details.logs.error).toBe('Refresh failed');
	const pending = state.loadRuntimeDetail('logs');
	await state.load('settings');
	stale.resolve(Response.json({ logs: { lines: ['Stale'] } }));
	await pending;
	expect(state.details.logs.value).toBeNull();
	expect(state.details.logs.loading).toBe(false);
});

test('Run now reports acceptance from the lightweight response without waiting for history or list hydration', async () => {
	let calls = 0;
	const response = deferred<Response>();
	const state = handlers(
		'../HermesPanel.svelte',
		'action, get notice() { return notice; }',
		{ dirtyGuard: new DirtyGuard(), view: 'schedules' },
		{
			parseApiResponse: (r: Response) => r.clone().json(),
			fetch: () => {
				calls++;
				return response.promise;
			}
		}
	);
	const running = state.action('schedule.run', { id: 'daily', runId: 'run-1' });
	void state.action('schedule.run', { id: 'daily', runId: 'run-2' });
	expect(calls).toBe(1);
	response.resolve(
		Response.json({
			target: { id: 'daily', name: 'Daily', sessionId: 's-1' },
			delivery: { status: 'queued', duplicate: false }
		})
	);
	await running;
	expect(state.notice).toContain('Run accepted');
	expect(state.notice).toContain('Session');
	expect(state.notice).not.toContain('completed');
	expect(calls).toBe(1);
});

test('Run now does not treat schedule metadata alone as acceptance', async () => {
	const state = handlers(
		'../HermesPanel.svelte',
		'action, get notice() { return notice; }, get error() { return error; }',
		{ dirtyGuard: new DirtyGuard(), view: 'schedules' },
		{
			parseApiResponse: (r: Response) => r.json(),
			fetch: async () => Response.json({ target: { id: 'daily', name: 'Daily' } })
		}
	);
	await state.action('schedule.run', { id: 'daily', runId: 'run-1' });
	expect(state.notice).toBe('');
	expect(state.error).toContain('acceptance could not be verified');
});

test('installed skill save preserves newer typing and does not claim it is saved', async () => {
	const response = deferred<Response>();
	const state = handlers(
		'../HermesPanel.svelte',
		`saveSkill, get content() { return skillContent; }, get baseline() { return originalSkillContent; }, get saved() { return skillSaved; },
		set content(v) { skillContent = v; }, init() { selectedSkill = 'custom'; selectedSkillEditable = true; skillContent = 'A'; originalSkillContent = 'old'; }`,
		{ dirtyGuard: new DirtyGuard(), view: 'skills' },
		{ fetch: () => response.promise, parseApiResponse: (r: Response) => r.json() }
	);
	state.init();
	const saving = state.saveSkill();
	state.content = 'B';
	response.resolve(Response.json({ content: 'A' }));
	await saving;
	expect(state.content).toBe('B');
	expect(state.baseline).toBe('A');
	expect(state.saved).toBe(false);
});

test('Bundle save updates the captured item without replacing a later editor', async () => {
	const response = deferred<unknown>();
	const state = handlers(
		'./PromptLibraryDialog.svelte',
		`saveBundle, get items() { return bundles; }, get selection() { return selectedBundleSlug; }, get description() { return bundleDescription; },
		init() { bundles = [{slug:'a'}, {slug:'b'}]; selectedBundleSlug = 'a'; bundleDescription = 'A'; }, switchEditor() { selectedBundleSlug = 'b'; bundleDescription = 'B'; }`,
		{ workflows: [], available: true },
		{ workspaceApi: () => response.promise }
	);
	state.init();
	const saving = state.saveBundle({ preventDefault() {} });
	state.switchEditor();
	response.resolve({ bundle: { slug: 'a', description: 'A', skills: [] } });
	await saving;
	expect(state.items.map((item: any) => item.slug)).toEqual(['a', 'b']);
	expect(state.selection).toBe('b');
	expect(state.description).toBe('B');
});

test('schedule history ignores reversed responses including A-to-B-to-A', async () => {
	const responses = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
	let call = 0;
	const state = handlers(
		'../hermes/SchedulesView.svelte',
		'loadHistory, get history() { return history; }',
		{ jobs: [] },
		{ fetch: () => responses[call++]!.promise, parseApiResponse: (r: Response) => r.json() }
	);
	const first = state.loadHistory({ id: 'a' });
	const second = state.loadHistory({ id: 'b' });
	const third = state.loadHistory({ id: 'a' });
	responses[2]!.resolve(Response.json({ newest: true }));
	await third;
	responses[1]!.resolve(Response.json({ stale: 'b' }));
	await second;
	responses[0]!.resolve(Response.json({ stale: 'a' }));
	await first;
	expect(state.history).toEqual({ newest: true });
});

test('administration action rejects double submits until acceptance and readback finish', async () => {
	const response = deferred<Response>();
	let calls = 0;
	const state = handlers(
		'../HermesPanel.svelte',
		'action',
		{ dirtyGuard: new DirtyGuard(), view: 'schedules' },
		{
			fetch: () => {
				calls++;
				return response.promise;
			},
			parseApiResponse: (r: Response) => r.clone().json()
		}
	);
	const first = state.action('schedule.run', { id: 'a' });
	void state.action('schedule.run', { id: 'a' });
	expect(calls).toBe(1);
	response.resolve(Response.json({ target: 'a', jobs: [] }));
	await first;
});

test('prompt, bundle and skill drafts require explicit discard before leaving', () => {
	let allow = false;
	let confirmations = 0;
	const state = handlers(
		'./PromptLibraryDialog.svelte',
		`startCreate, startBundleCreate, leaveEditor,
		get editor() { return editor; }, get dirty() { return isDirty(); },
		typePrompt() { name = 'Unsaved'; }, typeBundle() { bundleDescription = 'Unsaved'; },
		typeSkill() { openedSkill = 'custom'; skillEditable = true; skillBaseline = 'old'; skillContent = 'new'; }`,
		{ workflows: [], available: true },
		{
			window: {
				confirm() {
					confirmations++;
					return allow;
				}
			}
		}
	);
	state.startCreate();
	state.typePrompt();
	expect(state.leaveEditor()).toBe(false);
	expect(state.editor).toBe('create');
	allow = true;
	expect(state.leaveEditor()).toBe(true);
	state.startBundleCreate();
	state.typeBundle();
	allow = false;
	expect(state.leaveEditor()).toBe(false);
	allow = true;
	expect(state.leaveEditor()).toBe(true);
	state.typeSkill();
	allow = false;
	expect(state.leaveEditor()).toBe(false);
	expect(state.dirty).toBe(true);
	expect(confirmations).toBe(5);
});

test('an installed skill save from a closed and reopened editor cannot change the new baseline', async () => {
	const response = deferred<Response>();
	const state = handlers(
		'../HermesPanel.svelte',
		`saveSkill, discardSkillChanges, get content() { return skillContent; }, get baseline() { return originalSkillContent; },
		init(content) { selectedSkill = 'custom'; selectedSkillEditable = true; skillContent = content; originalSkillContent = content; }`,
		{ dirtyGuard: new DirtyGuard(), view: 'skills' },
		{ fetch: () => response.promise, parseApiResponse: (r: Response) => r.json() }
	);
	state.init('A');
	const saving = state.saveSkill();
	state.discardSkillChanges();
	state.init('B');
	response.resolve(Response.json({ content: 'A' }));
	await saving;
	expect(state.content).toBe('B');
	expect(state.baseline).toBe('B');
});

test('Bundle save retains newer fields as dirty and blocks a second request', async () => {
	const response = deferred<unknown>();
	let calls = 0;
	const state = handlers(
		'./PromptLibraryDialog.svelte',
		`saveBundle, get dirty() { return isDirty(); }, get description() { return bundleDescription; },
		init() { selectedBundleSlug = 'a'; bundleDescription = 'A'; bundles = [{slug:'a'}]; }, type() { bundleDescription = 'B'; }`,
		{ workflows: [], available: true },
		{
			workspaceApi: () => {
				calls++;
				return response.promise;
			}
		}
	);
	state.init();
	const saving = state.saveBundle({ preventDefault() {} });
	void state.saveBundle({ preventDefault() {} });
	expect(calls).toBe(1);
	state.type();
	response.resolve({ bundle: { slug: 'a', description: 'A', skills: [] } });
	await saving;
	expect(state.description).toBe('B');
	expect(state.dirty).toBe(true);
});

test('Workflow form failures stay local, block repeats, and keep newer edits open after acceptance', async () => {
	const response = deferred<boolean>();
	let calls = 0;
	const state = handlers(
		'./PromptLibraryDialog.svelte',
		`startCreate, saveCreate, get editor() { return editor; }, get error() { return workflowError; },
		type() { name = 'Newer'; }`,
		{
			workflows: [],
			available: true,
			onsubmit: () => {
				calls++;
				return response.promise;
			}
		}
	);
	state.startCreate();
	const saving = state.saveCreate({ preventDefault() {} });
	void state.saveCreate({ preventDefault() {} });
	expect(calls).toBe(1);
	state.type();
	response.resolve(true);
	await saving;
	expect(state.editor).toBe('create');
	expect(state.error).toBe('');
});
