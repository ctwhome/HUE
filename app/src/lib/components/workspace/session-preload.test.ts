import { expect, test } from 'bun:test';
import { preloadSessionViews } from './session-preload';
import type { Api, Project, SessionLoad } from './types';

test('preloads every non-archived Session across available Projects', async () => {
	const requests: string[] = [];
	const cached: Array<{ projectId: string; sessionId: string; body: SessionLoad }> = [];
	let active = 0;
	let peak = 0;
	const api = (async (path: string) => {
		requests.push(path);
		if (path.endsWith('?cached=true')) {
			const projectId = path.split('/')[3];
			return {
				sessions: [
					{ sessionId: `${projectId}-active`, cwd: '/work', archived: false },
					{ sessionId: `${projectId}-archived`, cwd: '/work', archived: true }
				],
				hasMore: false
			};
		}
		active += 1;
		peak = Math.max(peak, active);
		await Promise.resolve();
		active -= 1;
		return { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null };
	}) as Api;
	const projects = [
		{ id: 'one', rootAvailable: true },
		{ id: 'two', rootAvailable: true },
		{ id: 'offline', rootAvailable: false }
	] as Project[];

	await preloadSessionViews(projects, api, (projectId, sessionId, body) => {
		cached.push({ projectId, sessionId, body });
	});

	expect(requests.filter((path) => path.endsWith('?cached=true')).sort()).toEqual([
		'/api/projects/one/sessions?cached=true',
		'/api/projects/two/sessions?cached=true'
	]);
	expect(requests.filter((path) => !path.endsWith('?cached=true')).sort()).toEqual([
		'/api/projects/one/sessions/one-active',
		'/api/projects/two/sessions/two-active'
	]);
	expect(cached.map(({ projectId, sessionId }) => `${projectId}:${sessionId}`).sort()).toEqual([
		'one:one-active',
		'two:two-active'
	]);
	expect(peak).toBeLessThanOrEqual(3);
});

test('continues preloading when one Session fails', async () => {
	const cached: string[] = [];
	const api = (async (path: string) => {
		if (path.endsWith('?cached=true')) {
			return {
				sessions: [
					{ sessionId: 'broken', cwd: '/work', archived: false },
					{ sessionId: 'healthy', cwd: '/work', archived: false }
				]
			};
		}
		if (path.endsWith('/broken')) throw new Error('unavailable');
		return { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null };
	}) as Api;

	await preloadSessionViews([{ id: 'one', rootAvailable: true } as Project], api, (_project, id) =>
		cached.push(id)
	);

	expect(cached).toEqual(['healthy']);
});
