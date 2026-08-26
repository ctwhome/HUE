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
const stored: Array<{
	projectId: string;
	sessionId: string;
	cwd: string;
	workMode?: string | null;
}> = [];

mock.module('node:fs', () => ({ statSync: () => ({ isDirectory: () => true }) }));
mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => project,
	projectBranch: () => 'feat/test',
	sessionMatchesProjectFolders: (folders: string[], cwd: string) =>
		folders.some((folder) => cwd === folder || cwd.startsWith(`${folder}/`)),
	services: () => ({
		store: {
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
		runtime: {
			listSessions: async (root: string) => {
				listRoots.push(root);
				return root === '/work/app'
					? [{ sessionId: 'app-session', cwd: '/work/app/packages/api', title: 'API' }]
					: [{ sessionId: 'docs-session', cwd: '/work/docs/site', title: 'Docs' }];
			},
			createSession: async (root: string) => {
				createdRoots.push(root);
				return { sessionId: 'new-session', cwd: root, title: 'New' };
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
	stored.length = 0;
});

test('discovers Sessions under every Project folder and preserves actual cwd', async () => {
	const { GET } = await import('./+server');
	const response = await GET({
		params: { projectId: 'project-slug' },
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

test('creates new Hermes Session in primary folder', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug' },
		request: new Request('http://localhost/api/projects/p_1/sessions', { method: 'POST' })
	} as never);

	expect(response.status).toBe(201);
	expect(createdRoots).toEqual(['/work/app']);
	expect((await response.json()).session).toMatchObject({
		cwd: '/work/app',
		workMode: 'autonomous'
	});
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
