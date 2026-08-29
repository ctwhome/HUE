import { describe, expect, it } from 'bun:test';
import { acceptMessageWorkMode } from './work-mode-context';
import { HUEStore, MessageConflictError } from './store';

describe('durable message work-mode commands', () => {
	for (const projectId of ['project', null]) {
		it(`is idempotent for ${projectId ? 'Project' : 'projectless'} Sessions`, () => {
			const store = new HUEStore(':memory:');
			if (projectId) store.ensureProjectMetadata(projectId, 'Project');
			store.upsertSession(projectId, { sessionId: 'session', cwd: '/work' });
			const envelope = {
				id: 'command',
				projectId,
				sessionId: 'session',
				text: '/live-co-development'
			};

			expect(acceptMessageWorkMode(store, envelope, false)).toMatchObject({
				duplicate: false,
				status: 'completed',
				workMode: 'live',
				consumed: true
			});
			expect(acceptMessageWorkMode(store, envelope, false)).toMatchObject({
				duplicate: true,
				status: 'completed',
				workMode: 'live',
				consumed: true
			});
			expect(() =>
				acceptMessageWorkMode(store, { ...envelope, text: '/autonomous-delivery' }, false)
			).toThrow(MessageConflictError);
			expect(store.getSession(projectId, 'session')?.workMode).toBe('live');
			acceptMessageWorkMode(
				store,
				{ ...envelope, id: 'new-command', text: '/autonomous-delivery' },
				false
			);
			expect(acceptMessageWorkMode(store, envelope, false)).toMatchObject({
				duplicate: true,
				status: 'completed',
				workMode: 'live'
			});
			expect(store.getMessage('command')?.status).toBe('completed');
			store.close();
		});
	}
});
