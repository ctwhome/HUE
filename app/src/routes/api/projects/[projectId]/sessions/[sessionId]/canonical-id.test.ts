import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const projectIds: Array<{ method: string; id: string }> = [];
const canonicalProject = {
	id: 'canonical-project',
	primary_path: '/work/hue',
	archived: false
};
const session = {
	sessionId: 'session',
	cwd: '/work/hue',
	icon: null,
	title: 'Session',
	pinned: false,
	archived: false,
	folder: null,
	tags: []
};

function record(method: string, id: string) {
	projectIds.push({ method, id });
}

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => canonicalProject,
	projectBranch: () => null,
	services: () => ({
		store: {
			hasSession: (id: string) => (record('hasSession', id), true),
			getSession: (id: string) => (record('getSession', id), session),
			getSessionSnapshot: (id: string) => (
				record('getSessionSnapshot', id),
				{ messages: [], events: [], cursor: 0, activeTurn: null }
			),
			prepareSessionCopy: (id: string) => (
				record('prepareSessionCopy', id),
				{ title: 'Session copy', pinned: false, archived: false, folder: null, tags: [] }
			),
			upsertSession: (id: string) => record('upsertSession', id),
			copySessionMetadata: (id: string) => (record('copySessionMetadata', id), session),
			updateSession: (id: string) => (record('updateSession', id), session),
			previewSessionDelete: (id: string) => (
				record('previewSessionDelete', id),
				{ messages: 0, events: 0 }
			),
			deleteSession: (id: string) => record('deleteSession', id)
		},
		runtime: {
			getCapabilities: () => ({ sessionFork: true }),
			loadTranscript: async () => [],
			forkSession: async () => ({ ...session, sessionId: 'forked' }),
			getAvailableCommands: () => [],
			getSessionState: () => ({}),
			setModel: async () => ({})
		},
		dispatcher: {
			withSessionLock: async (_id: string, operation: () => Promise<unknown>) => operation()
		}
	})
}));

test('uses canonical Hermes id for Session export, duplicate, patch, delete, and ownership', async () => {
	projectIds.length = 0;
	const { GET, POST, PATCH, DELETE } = await import('./+server');
	const params = { projectId: 'project-slug', sessionId: 'session' };

	expect(
		(await GET({ params, url: new URL('http://hue.test/session?format=json') } as never)).status
	).toBe(200);
	expect(
		(
			await POST({
				params,
				request: new Request('http://hue.test/session', { method: 'POST', body: '{}' })
			} as never)
		).status
	).toBe(201);
	expect(
		(
			await PATCH({
				params,
				request: new Request('http://hue.test/session', {
					method: 'PATCH',
					body: JSON.stringify({ title: 'Renamed' })
				})
			} as never)
		).status
	).toBe(200);
	expect(
		(await DELETE({ params, url: new URL('http://hue.test/session?confirm=true') } as never)).status
	).toBe(200);

	expect(new Set(projectIds.map(({ method }) => method))).toEqual(
		new Set([
			'hasSession',
			'getSession',
			'getSessionSnapshot',
			'prepareSessionCopy',
			'upsertSession',
			'copySessionMetadata',
			'updateSession',
			'previewSessionDelete',
			'deleteSession'
		])
	);
	expect(projectIds.every(({ id }) => id === 'canonical-project')).toBe(true);
});
