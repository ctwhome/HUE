import { beforeEach, expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const project = {
	id: 'p_1',
	name: 'Workspace',
	icon: null,
	primary_path: '/work/app',
	folders: [
		{ path: '/work/app', label: null, is_primary: true, added_at: 1 },
		{ path: '/work/docs', label: null, is_primary: false, added_at: 2 }
	],
	archived: false
};
const listRoots: string[] = [];
const createdRoots: string[] = [];
const createdHarnesses: string[] = [];
let authoritativeCalls = 0;
const stored: Array<{
	projectId: string;
	sessionId: string;
	cwd: string;
	workMode?: string | null;
}> = [];

mock.module('node:fs', () => ({ statSync: () => ({ isDirectory: () => true }) }));
mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => {
		authoritativeCalls += 1;
		return project;
	},
	projectBranch: () => 'feat/test',
	sessionMatchesProjectFolders: (folders: string[], cwd: string) =>
		folders.some((folder) => cwd === folder || cwd.startsWith(`${folder}/`)),
	services: () => ({
		store: {
			hasProjectMetadata: (id: string) => id === project.id,
			getSession: (projectId: string, sessionId: string) => {
				const session = stored.find(
					(candidate) => candidate.projectId === projectId && candidate.sessionId === sessionId
				);
				return session
					? {
							...session,
							icon: null,
							title: null,
							workMode: session.workMode ?? 'autonomous',
							pinned: false,
							archived: false,
							folder: null,
							tags: [],
							updatedAt: '2026-08-22T00:00:00.000Z'
						}
					: null;
			},
			listSessionRoots: () => [],
			isSessionDismissed: () => false,
			upsertSession: (
				projectId: string,
				session: { sessionId: string; cwd: string; workMode?: string | null }
			) => stored.push({ projectId, ...session }),
			getBusySessionStarts: () => ({}),
			getSessionIndicators: () => ({}),
			listSessionPage: () => ({
				sessions: stored.map(({ sessionId, cwd }) => ({
					sessionId,
					cwd,
					icon: null,
					title: null,
					pinned: false,
					archived: false,
					folder: null,
					tags: [],
					updatedAt: '2026-08-22T00:00:00.000Z'
				})),
				hasMore: false
			})
		},
		sessionRuntime: {
			listSessions: async (root: string, harness = 'hermes') => {
				if (harness === 'opencode') return [];
				listRoots.push(root);
				return root === '/work/app'
					? [{ sessionId: 'app-session', cwd: '/work/app/packages/api', title: 'API' }]
					: [{ sessionId: 'docs-session', cwd: '/work/docs/site', title: 'Docs' }];
			},
			createSession: async (root: string, harness = 'hermes') => {
				createdRoots.push(root);
				createdHarnesses.push(harness);
				return {
					sessionId: harness === 'opencode' ? 'opencode:new-session' : 'new-session',
					externalSessionId: 'new-session',
					harness,
					cwd: root,
					title: 'New'
				};
			},
			getAvailableCommands: () => [],
			getSessionState: () => ({})
		},
		dispatcher: { recover: () => undefined }
	})
}));

beforeEach(() => {
	listRoots.length = 0;
	createdRoots.length = 0;
	createdHarnesses.length = 0;
	stored.length = 0;
	authoritativeCalls = 0;
});

test('discovers Sessions under every Project folder and preserves actual cwd', async () => {
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'p_1' },
		url: new URL('http://localhost/api/projects/p_1/sessions')
	} as never);
	const body = await response.json();

	expect(response.status).toBe(200);
	expect(listRoots).toEqual(['/work/app', '/work/docs']);
	expect(body.sessions.map(({ cwd }: { cwd: string }) => cwd)).toEqual([
		'/work/app/packages/api',
		'/work/docs/site'
	]);
	expect(stored.map(({ projectId }) => projectId)).toEqual(['p_1', 'p_1']);
});

test('returns cached Session titles without listing Hermes Sessions', async () => {
	stored.push({ projectId: 'p_1', sessionId: 'cached-session', cwd: '/work/app' });
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'p_1' },
		url: new URL('http://localhost/api/projects/p_1/sessions?cached=true')
	} as never);

	expect(response.status).toBe(200);
	expect((await response.json()).sessions).toEqual([
		expect.objectContaining({ sessionId: 'cached-session' })
	]);
	expect(listRoots).toEqual([]);
	expect(authoritativeCalls).toBe(0);
});

test('creates new Hermes Session in primary folder', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug' },
		request: new Request('http://localhost/api/projects/p_1/sessions', { method: 'POST' })
	} as never);

	expect(response.status).toBe(201);
	expect(createdRoots).toEqual(['/work/app']);
	expect(createdHarnesses).toEqual(['hermes']);
	expect((await response.json()).session).toMatchObject({
		cwd: '/work/app',
		workMode: 'autonomous'
	});
});

test('creates an OpenCode Session when explicitly requested', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug' },
		request: new Request('http://localhost/api/projects/p_1/sessions', {
			method: 'POST',
			body: JSON.stringify({ harness: 'opencode' })
		})
	} as never);

	expect(response.status).toBe(201);
	expect(createdHarnesses).toEqual(['opencode']);
	expect((await response.json()).session).toMatchObject({
		sessionId: 'opencode:new-session',
		harness: 'opencode'
	});
});

test('rejects an unknown Session harness before creation', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug' },
		request: new Request('http://localhost/api/projects/p_1/sessions', {
			method: 'POST',
			body: JSON.stringify({ harness: 'other' })
		})
	} as never);

	expect(response.status).toBe(400);
	expect(createdRoots).toEqual([]);
});

test('creates a Workflow Session with its requested HUE work mode', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug' },
		request: new Request('http://localhost/api/projects/p_1/sessions', {
			method: 'POST',
			body: JSON.stringify({ workMode: 'live' })
		})
	} as never);

	expect(response.status).toBe(201);
	expect((await response.json()).session).toMatchObject({ workMode: 'live' });
});
