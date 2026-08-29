import { expect, mock, test } from 'bun:test';
import type { Api, Project, Session, SessionEvent } from './types';

Object.assign(globalThis, { $state: <T>(value?: T) => value });
mock.module('$app/navigation', () => ({ pushState() {}, replaceState() {} }));
mock.module('$app/state', () => ({ page: { state: {} } }));
const { WorkspaceNavigation } = await import('./navigation.svelte');

function navigation(api: Api = (async () => ({})) as Api) {
	return new WorkspaceNavigation(null, { api } as never);
}

const infoEvent = (title: string): SessionEvent => ({
	sequence: 1,
	type: 'session.info_updated',
	payload: { title }
});

test('session info events update titles and derive icons without replacing custom icons', () => {
	const automatic = { sessionId: 'auto', cwd: '/work', title: null, customIcon: null } as Session;
	const custom = {
		sessionId: 'custom',
		cwd: '/work',
		title: null,
		icon: '⭐',
		customIcon: '⭐'
	} as Session;
	const state = navigation();
	state.sessions = [automatic, custom];
	state.selectedSession = automatic;

	state.applySessionInfoEvents([infoEvent('Debug message delivery')]);

	expect(state.sessions[0]).toMatchObject({ title: 'Debug message delivery', icon: '🐛' });
	expect(state.selectedSession).toMatchObject({ title: 'Debug message delivery', icon: '🐛' });
	state.selectedSession = custom;
	state.applySessionInfoEvents([infoEvent('Implement title updates')]);
	expect(state.sessions[1]).toMatchObject({ title: 'Implement title updates', icon: '⭐' });
});

test('replaceSession works when passed as a callback', () => {
	const session = { sessionId: 'session-1', cwd: '/work', title: 'Old title' } as Session;
	const state = navigation();
	state.sessions = [session];
	state.selectedSession = session;
	const replaceSession = state.replaceSession;

	replaceSession({ ...session, title: 'New title' });

	expect(state.sessions[0]?.title).toBe('New title');
	expect(state.selectedSession?.title).toBe('New title');
});

test('saving a session icon does not claim title authority', async () => {
	let request: RequestInit | undefined;
	const state = navigation((async (_path, options) => {
		request = options;
		return { session: { sessionId: 'session-1', cwd: '/work', title: 'Generated' }, icon: '⭐' };
	}) as Api);
	state.editingSession = { sessionId: 'session-1', cwd: '/work', title: 'Generated' };
	state.sessionIcon = '⭐';

	await state.saveSessionIcon();

	expect(JSON.parse(String(request?.body))).toEqual({ icon: '⭐' });
});

test('saving other session metadata only includes a title when it changed', async () => {
	let request: RequestInit | undefined;
	const state = navigation((async (_path, options) => {
		request = options;
		return { session: { sessionId: 'session-1', cwd: '/work', title: 'Generated' }, icon: null };
	}) as Api);
	state.editingSession = { sessionId: 'session-1', cwd: '/work', title: 'Generated' };
	state.sessionTitle = 'Generated';
	state.sessionPinned = true;

	await state.saveSession();

	expect(JSON.parse(String(request?.body))).not.toContainKey('title');
});

test('Session creation and archiving keep the selected Project count current', async () => {
	const project = { id: 'hue', rootAvailable: true, sessionCount: 1 } as Project;
	const state = new WorkspaceNavigation(project, {
		api: async () => ({ session: { sessionId: 'existing', cwd: '/work', archived: true } }),
		setError() {}
	} as never);
	const existing = { sessionId: 'existing', cwd: '/work' } as Session;
	state.sessions = [existing];

	state.prependSession({ sessionId: 'new', cwd: '/work' });
	expect(project.sessionCount).toBe(2);
	await state.archiveSession({ stopPropagation() {} } as MouseEvent, existing);
	expect(project.sessionCount).toBe(1);
});

test('Session creation and archiving keep the standalone Chats count current', async () => {
	let count = 1;
	const state = new WorkspaceNavigation(null, {
		api: async () => ({ session: { sessionId: 'existing', cwd: '/work', archived: true } }),
		adjustChatSessionCount: (change: number) => (count += change),
		setError() {}
	} as never);
	const existing = { sessionId: 'existing', cwd: '/work' } as Session;
	state.sessions = [existing];

	state.prependSession({ sessionId: 'new', cwd: '/work' });
	expect(count).toBe(2);
	await state.archiveSession({ stopPropagation() {} } as MouseEvent, existing);
	expect(count).toBe(1);
});

test('workflow mutations remain scoped to the selected project', async () => {
	const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
	const state = new WorkspaceNavigation(
		{ id: 'hue', rootAvailable: true } as never,
		{
			api: async (path: string, options?: RequestInit) => {
				requests.push({
					path,
					method: options?.method ?? 'GET',
					body: options?.body ? JSON.parse(String(options.body)) : {}
				});
				if (options?.method === 'DELETE') return { deleted: true };
				return {
					workflow: {
						id: options?.method === 'POST' ? 'release-copy' : 'release',
						name: 'Ship release',
						prompt: 'Run checks.',
						profile: 'default',
						workMode: 'live',
						archived: false
					}
				};
			},
			setError() {}
		} as never
	);
	state.workflows = [
		{
			id: 'release',
			name: 'Prepare release',
			prompt: 'Old prompt',
			profile: 'default',
			workMode: 'autonomous',
			archived: false
		}
	];

	await state.updateWorkflow(state.workflows[0], {
		name: 'Ship release',
		prompt: 'Run checks.',
		profile: 'default',
		workMode: 'live'
	});
	await state.duplicateWorkflow(state.workflows[0]);
	await state.deleteWorkflow(state.workflows[0]);

	expect(requests).toEqual([
		{
			path: '/api/projects/hue/workflows/release',
			method: 'PATCH',
			body: {
				name: 'Ship release',
				prompt: 'Run checks.',
				profile: 'default',
				workMode: 'live'
			}
		},
		{
			path: '/api/projects/hue/workflows',
			method: 'POST',
			body: {
				name: 'Ship release copy',
				prompt: 'Run checks.',
				profile: 'default',
				workMode: 'live'
			}
		},
		{ path: '/api/projects/hue/workflows/release', method: 'DELETE', body: {} }
	]);
	expect(state.workflows).toEqual([expect.objectContaining({ id: 'release-copy' })]);
});

test('workflow launch applies its work mode before sending the saved prompt', async () => {
	const calls: string[] = [];
	let createBody = {};
	let launchError = '';
	const state = new WorkspaceNavigation(
		{ id: 'hue', rootAvailable: true } as never,
		{
			api: async (path: string, options?: RequestInit) => {
				calls.push(`${options?.method ?? 'GET'} ${path}`);
				if (options?.method === 'POST') createBody = JSON.parse(String(options.body));
				return options?.method === 'POST'
					? { session: { sessionId: 'new', cwd: '/work', workMode: 'autonomous' } }
					: { workMode: 'live' };
			},
			getRuntimeProfile: () => 'default',
			guard: () => false,
			endVoice() {},
			saveDraft() {},
			cacheSession() {},
			clearSession() {},
			clearSessionState() {},
			setLoading() {},
			persistSelection() {},
			applyCreatedSession() {},
			setError: (message: string) => (launchError = message),
			restoreDraft() {},
			focusComposer() {},
			sendText: async (text: string) => {
				calls.push(`SEND ${text}`);
				return true;
			}
		} as never
	);
	state.persistSelection = () => {};

	await state.runWorkflow({
		id: 'release',
		name: 'Release',
		prompt: 'Run checks.',
		profile: 'default',
		workMode: 'live',
		archived: false
	});

	expect(launchError).toBe('');
	expect(calls).toEqual(['POST /api/projects/hue/sessions', 'SEND Run checks.']);
	expect(createBody).toEqual({ workMode: 'live' });
});

test('workflow launch does not create a session under the wrong Hermes profile', async () => {
	let error = '';
	const state = new WorkspaceNavigation(
		{ id: 'hue', rootAvailable: true } as never,
		{
			guard: () => false,
			getRuntimeProfile: () => 'default',
			setError: (message: string) => (error = message)
		} as never
	);

	await state.runWorkflow({
		id: 'release',
		name: 'Release',
		prompt: 'Run checks.',
		profile: 'work',
		workMode: 'autonomous',
		archived: false
	});

	expect(error).toContain('HUE_HERMES_PROFILE=work');
});

test('workflow mutation response cannot overwrite a newly selected project', async () => {
	let resolve!: (value: unknown) => void;
	const response = new Promise((done) => (resolve = done));
	const state = new WorkspaceNavigation(
		{ id: 'one', rootAvailable: true } as never,
		{ api: async () => response, setError() {} } as never
	);
	const workflow = {
		id: 'same-id',
		name: 'Project one',
		prompt: 'One',
		profile: 'default',
		workMode: 'autonomous',
		archived: false
	} as const;
	state.workflows = [workflow];
	const updating = state.updateWorkflow(workflow, { name: 'Updated one' });
	state.selectedProject = { id: 'two', rootAvailable: true } as never;
	state.workflows = [{ ...workflow, name: 'Project two' }];
	resolve({ workflow: { ...workflow, name: 'Updated one' } });

	await updating;
	expect(state.workflows[0].name).toBe('Project two');
});
