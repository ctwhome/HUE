import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HUEStore, MessageConflictError } from './store';

const temporaryDatabases: string[] = [];

afterEach(() => {
	for (const path of temporaryDatabases.splice(0)) rmSync(path, { force: true });
});

function makeStore() {
	return new HUEStore(':memory:');
}

function makeDeliveryStore() {
	const store = makeStore();
	store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
	store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	return store;
}

describe('HUEStore project and workflow boundaries', () => {
	it('persists a local status color without changing Project identity', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });

		expect(store.getProjectColor('hue')).toBeNull();
		store.updateProjectColor('hue', '#7aa2f7');

		expect(store.getProjectColor('hue')).toBe('#7aa2f7');
		expect(store.getProject('hue')).toMatchObject({ id: 'hue', name: 'HUE' });
		store.close();
	});

	it('persists an optional local group label without changing Project identity', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });

		expect(store.getProjectGroup('hue')).toBeNull();
		store.updateProjectGroup('hue', 'Client work');
		expect(store.getProjectGroup('hue')).toBe('Client work');
		store.updateProjectGroup('hue', null);

		expect(store.getProjectGroup('hue')).toBeNull();
		expect(store.getProject('hue')).toMatchObject({ id: 'hue', name: 'HUE' });
		store.close();
	});

	it('stores one independently updateable Excalidraw scene per Project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		expect(store.getProjectExcalidraw('hue')).toBeNull();

		store.updateProjectExcalidraw('hue', { address: 'https://example.com/' });
		store.updateProjectExcalidraw('hue', {
			scene: '{"version":1,"elements":[],"appState":{}}'
		});

		expect(store.getProjectExcalidraw('hue')).toMatchObject({
			projectId: 'hue',
			address: 'https://example.com/',
			scene: '{"version":1,"elements":[],"appState":{}}'
		});
		store.close();
	});

	it('persists Session rename pin archive folder and optional tags without changing ownership', () => {
		const store = makeDeliveryStore();
		store.updateSessionMetadata('hue', 'session-1', {
			title: 'Release investigation',
			pinned: true,
			archived: true,
			folder: 'Delivery',
			tags: ['release', 'blocked']
		});

		expect(store.getSession('hue', 'session-1')).toMatchObject({
			title: 'Release investigation',
			pinned: true,
			archived: true,
			folder: 'Delivery',
			tags: ['release', 'blocked'],
			workMode: 'autonomous'
		});
		expect(store.hasSession('hue', 'session-1')).toBe(true);
		expect(store.hasSession(null, 'session-1')).toBe(false);
		store.close();
	});

	it('migrates and validates per-session work mode for project and projectless Sessions', () => {
		const path = join(tmpdir(), `hue-work-mode-${crypto.randomUUID()}.sqlite`);
		temporaryDatabases.push(path);
		const database = new Database(path);
		database.exec(`
			CREATE TABLE projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				root_path TEXT NOT NULL UNIQUE,
				icon TEXT,
				legacy INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL
			);
			CREATE TABLE project_sessions (
				session_id TEXT PRIMARY KEY,
				project_id TEXT,
				cwd TEXT NOT NULL,
				icon TEXT,
				title TEXT,
				title_custom INTEGER NOT NULL DEFAULT 0,
				pinned INTEGER NOT NULL DEFAULT 0,
				archived INTEGER NOT NULL DEFAULT 0,
				folder TEXT,
				tags TEXT NOT NULL DEFAULT '[]',
				updated_at TEXT NOT NULL
			);
			INSERT INTO projects (id, name, root_path, created_at)
			VALUES ('hue', 'HUE', '/work/hue', '2026-08-23T00:00:00.000Z');
			INSERT INTO project_sessions (session_id, project_id, cwd, updated_at)
			VALUES
				('project-session', 'hue', '/work/hue', '2026-08-23T00:00:00.000Z'),
				('projectless-session', NULL, '/work/loose', '2026-08-23T00:00:00.000Z');
		`);
		database.close();

		const store = new HUEStore(path);
		expect(store.getSession('hue', 'project-session')?.workMode).toBe('autonomous');
		expect(store.getSession(null, 'projectless-session')?.workMode).toBe('autonomous');

		const updated = store.updateSessionWorkMode('hue', 'project-session', 'live', 'user');
		expect(updated.workMode).toBe('live');
		expect(
			store
				.listEvents('hue', 'project-session')
				.find((event) => event.type === 'session.work_mode_changed')?.payload
		).toEqual({
			priorMode: 'autonomous',
			workMode: 'live',
			source: 'user'
		});
		expect(store.updateSessionWorkMode('hue', 'project-session', 'live', 'user')).toEqual(updated);
		expect(
			store
				.listEvents('hue', 'project-session')
				.filter((event) => event.type === 'session.work_mode_changed')
		).toHaveLength(1);
		expect(() =>
			store.database
				.query(
					"UPDATE project_sessions SET work_mode = 'pair' WHERE session_id = 'project-session'"
				)
				.run()
		).toThrow();
		store.close();
	});

	it('forked Session defaults back to autonomous instead of copying work mode', () => {
		const store = makeDeliveryStore();
		store.updateSessionWorkMode('hue', 'session-1', 'live', 'user');
		store.upsertSession('hue', { sessionId: 'fork-2', cwd: '/work/hue' });

		store.copySessionMetadata('hue', 'session-1', 'fork-2', 'Fork copy');

		expect(store.getSession('hue', 'fork-2')?.workMode).toBe('autonomous');
		expect(
			store.listEvents('hue', 'fork-2').filter(({ type }) => type === 'session.work_mode_changed')
		).toHaveLength(0);
		store.close();
	});

	it('leaves project and projectless Session metadata unchanged when a combined icon is invalid', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'project-session', cwd: '/work/hue', title: 'Before' });
		store.upsertSession(null, {
			sessionId: 'projectless-session',
			cwd: '/work/topics',
			title: 'Before'
		});

		for (const [projectId, sessionId] of [
			['hue', 'project-session'],
			[null, 'projectless-session']
		] as const) {
			expect(() =>
				store.updateSession(projectId, sessionId, {
					title: 'After',
					pinned: true,
					icon: 'data:text/html;base64,PHNjcmlwdD4='
				})
			).toThrow('Project icon must be a short emoji');
			expect(store.getSession(projectId, sessionId)).toMatchObject({
				title: 'Before',
				pinned: false,
				icon: null
			});
		}
		store.close();
	});

	it('projects runtime titles as cursor events without replacing manual metadata', () => {
		const store = makeDeliveryStore();
		store.updateSession('hue', 'session-1', { icon: '⭐' });

		const event = store.applyRuntimeSessionTitle('session-1', 'Debug message delivery');

		expect(store.getSession('hue', 'session-1')).toMatchObject({
			title: 'Debug message delivery',
			icon: '⭐'
		});
		expect(event).toMatchObject({
			projectId: 'hue',
			sessionId: 'session-1',
			type: 'session.info_updated',
			payload: { title: 'Debug message delivery' }
		});

		store.updateSession('hue', 'session-1', { title: 'My manual title' });
		expect(store.applyRuntimeSessionTitle('session-1', 'Late generated title')).toBeNull();
		expect(store.getSession('hue', 'session-1')).toMatchObject({
			title: 'My manual title',
			icon: '⭐'
		});
		expect(
			store.listEvents('hue', 'session-1').filter(({ type }) => type === 'session.info_updated')
		).toHaveLength(1);
		store.close();
	});

	it('searches Session title and durable user or assistant content with a bounded result limit', () => {
		const store = makeDeliveryStore();
		store.upsertSession('hue', { sessionId: 'session-2', cwd: '/work/hue', title: 'Deploy notes' });
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Investigate cursor replay'
		});
		store.appendEvent('hue', 'session-2', 'agent.chunk', {
			messageId: 'msg-2',
			text: 'Compression completed safely'
		});

		expect(store.searchSessions('hue', 'deploy', 100).map(({ sessionId }) => sessionId)).toEqual([
			'session-2'
		]);
		expect(store.searchSessions('hue', 'cursor').map(({ sessionId }) => sessionId)).toEqual([
			'session-1'
		]);
		expect(store.searchSessions('hue', 'compression').map(({ sessionId }) => sessionId)).toEqual([
			'session-2'
		]);
		expect(store.searchSessions('hue', '', 500)).toHaveLength(2);
		store.close();
	});

	it('finds HUE-indexed Sessions globally with ownership metadata and authoritative status', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'docs', name: 'Documentation', rootPath: '/work/docs' });
		store.upsertSession('hue', {
			sessionId: 'running',
			cwd: '/work/hue',
			title: 'Release control'
		});
		store.updateSessionMetadata('hue', 'running', {
			folder: 'Delivery',
			tags: ['p1-review']
		});
		store.acceptMessage({
			id: 'running-message',
			projectId: 'hue',
			sessionId: 'running',
			text: 'Ship command palette'
		});
		store.updateMessageStatus('running-message', 'running');
		store.upsertSession('docs', {
			sessionId: 'archived',
			cwd: '/work/docs',
			title: 'Historical finder'
		});
		store.updateSessionMetadata('docs', 'archived', { archived: true });
		store.upsertSession(null, {
			sessionId: 'loose',
			cwd: '/work/loose',
			title: 'Loose notes'
		});
		store.appendEvent(null, 'loose', 'agent.chunk', { text: 'Projectless evidence' });
		store.appendEvent(null, 'loose', 'agent.chunk', {
			messageId: 'internal-event-token',
			text: 'Ordinary output'
		});
		store.appendEvent(null, 'loose', 'runtime.secret', { text: 'must-not-match' });

		expect(store.findSessions('p1-review')).toEqual([
			expect.objectContaining({
				projectId: 'hue',
				projectName: 'HUE',
				sessionId: 'running',
				status: 'running'
			})
		]);
		expect(store.findSessions('projectless')).toEqual([
			expect.objectContaining({ projectId: null, projectName: null, sessionId: 'loose' })
		]);
		expect(store.findSessions('documentation', 'archived')).toEqual([
			expect.objectContaining({ sessionId: 'archived', status: 'archived' })
		]);
		expect(store.findSessions('must-not-match')).toEqual([]);
		expect(store.findSessions('internal-event-token')).toEqual([]);
		expect(() => store.findSessions('x'.repeat(201))).toThrow('Search query is too long');
		store.close();
	});

	it('reports a running turn after an older turn was cancelled', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'cancelled-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Cancel this'
		});
		store.transitionMessage('cancelled-message', 'running', { messageId: 'cancelled-message' });
		store.transitionCancelledMessage('cancelled-message');
		store.acceptMessage({
			id: 'running-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Run this instead'
		});
		store.transitionMessage('running-message', 'running', { messageId: 'running-message' });

		expect(store.findSessions('', 'running').map(({ sessionId }) => sessionId)).toEqual([
			'session-1'
		]);
		expect(store.findSessions('').at(0)?.status).toBe('running');
		store.close();
	});

	it('reports cancellation when it belongs to the latest turn', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'running-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'First turn'
		});
		store.transitionMessage('running-message', 'running', { messageId: 'running-message' });
		store.acceptMessage({
			id: 'cancelled-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Second turn'
		});
		store.transitionMessage('cancelled-message', 'running', { messageId: 'cancelled-message' });
		store.transitionCancelledMessage('cancelled-message');

		expect(store.findSessions('').at(0)?.status).toBeNull();
		expect(store.findSessions('', 'running')).toEqual([]);
		store.close();
	});

	it('ignores waiting state from an older turn', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'waiting-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'First turn'
		});
		store.transitionMessage('waiting-message', 'running', { messageId: 'waiting-message' });
		store.appendEvent('hue', 'session-1', 'agent.permission', {
			id: 'permission-1',
			messageId: 'waiting-message',
			status: 'pending'
		});
		store.acceptMessage({
			id: 'running-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Second turn'
		});
		store.transitionMessage('running-message', 'running', { messageId: 'running-message' });

		expect(store.findSessions('').at(0)?.status).toBe('running');
		expect(store.findSessions('', 'waiting')).toEqual([]);
		store.close();
	});

	it('preserves terminal and waiting status for the latest turn', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		for (const status of ['completed', 'failed', 'unknown'] as const) {
			store.upsertSession('hue', { sessionId: status, cwd: '/work/hue' });
			store.acceptMessage({
				id: `${status}-message`,
				projectId: 'hue',
				sessionId: status,
				text: status
			});
			store.transitionMessage(`${status}-message`, 'running', { messageId: `${status}-message` });
			store.transitionMessage(`${status}-message`, status, { messageId: `${status}-message` });
		}
		store.upsertSession('hue', { sessionId: 'waiting', cwd: '/work/hue' });
		store.acceptMessage({
			id: 'waiting-message',
			projectId: 'hue',
			sessionId: 'waiting',
			text: 'Wait'
		});
		store.transitionMessage('waiting-message', 'running', { messageId: 'waiting-message' });
		store.appendEvent('hue', 'waiting', 'agent.clarify', {
			id: 'clarify-1',
			messageId: 'waiting-message',
			status: 'pending'
		});

		const statuses = Object.fromEntries(
			store.findSessions('').map(({ sessionId, status }) => [sessionId, status])
		);
		expect(statuses).toEqual({
			completed: null,
			failed: 'failed',
			unknown: 'unknown',
			waiting: 'waiting'
		});
		store.close();
	});

	it('reports a terminal lifecycle after an earlier pending interaction', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		for (const status of ['completed', 'failed', 'unknown'] as const) {
			store.upsertSession('hue', { sessionId: status, cwd: '/work/hue' });
			store.acceptMessage({
				id: `${status}-message`,
				projectId: 'hue',
				sessionId: status,
				text: status
			});
			store.transitionMessage(`${status}-message`, 'running', { messageId: `${status}-message` });
			store.appendEvent('hue', status, 'agent.permission', {
				id: `${status}-permission`,
				messageId: `${status}-message`,
				status: 'pending'
			});
			store.transitionMessage(`${status}-message`, status, { messageId: `${status}-message` });
		}

		const statuses = Object.fromEntries(
			store.findSessions('').map(({ sessionId, status }) => [sessionId, status])
		);
		expect(statuses).toEqual({ completed: null, failed: 'failed', unknown: 'unknown' });
		store.close();
	});

	it('paginates beyond 500 Sessions and beyond 50 search matches in SQLite', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		for (let index = 0; index < 551; index += 1) {
			store.upsertSession('hue', {
				sessionId: `session-${index.toString().padStart(3, '0')}`,
				cwd: '/work/hue',
				title: index < 80 ? `Needle result ${index}` : `Other ${index}`,
				updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
			});
		}

		const deep = store.listSessionPage('hue', {
			includeArchived: false,
			query: '',
			limit: 100,
			offset: 500
		});
		expect(deep.sessions).toHaveLength(51);
		expect(deep.hasMore).toBe(false);

		const search = store.listSessionPage('hue', {
			includeArchived: false,
			query: 'needle',
			limit: 25,
			offset: 50
		});
		expect(search.sessions).toHaveLength(25);
		expect(search.hasMore).toBe(true);
		const searchEnd = store.listSessionPage('hue', {
			includeArchived: false,
			query: 'needle',
			limit: 25,
			offset: 75
		});
		expect(searchEnd.sessions).toHaveLength(5);
		expect(searchEnd.hasMore).toBe(false);
		store.close();
	});

	it('previews exact Session delete impact and blocks deletion with unresolved delivery', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Queued',
			images: [{ name: 'screen.png', mimeType: 'image/png', data: 'aGVsbG8=' }]
		});

		expect(store.previewSessionDelete('hue', 'session-1')).toEqual({
			sessionId: 'session-1',
			messages: 1,
			events: 1,
			attachments: 1,
			activeDeliveries: 1,
			reversibleAlternative: 'archive'
		});
		expect(() => store.deleteSession('hue', 'session-1')).toThrow('active message deliveries');
		store.updateMessageStatus('msg-1', 'failed');
		expect(store.deleteSession('hue', 'session-1')).toBe(true);
		expect(store.previewSessionDelete('hue', 'session-1')).toBeNull();
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		expect(store.hasSession('hue', 'session-1')).toBe(false);
		expect(store.isSessionDismissed('hue', 'session-1')).toBe(true);
		store.close();
	});

	it('copies only HUE-owned organization metadata when Hermes duplicates a Session', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'source-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review source',
			attachments: [{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' }]
		});
		store.transitionMessage('source-message', 'running', { messageId: 'source-message' });
		store.transitionMessage('source-message', 'completed', { messageId: 'source-message' });
		store.updateSessionMetadata('hue', 'session-1', {
			title: 'Source',
			pinned: true,
			archived: true,
			folder: 'Reviews',
			tags: ['safe']
		});
		store.upsertSession('hue', { sessionId: 'fork-1', cwd: '/work/hue' });

		store.copySessionMetadata('hue', 'session-1', 'fork-1', 'Source copy');

		expect(store.getSession('hue', 'fork-1')).toMatchObject({
			title: 'Source copy',
			pinned: false,
			archived: false,
			folder: 'Reviews',
			tags: ['safe']
		});
		const copied = store.listMessages('hue', 'fork-1');
		expect(copied).toHaveLength(1);
		expect(copied[0]).toMatchObject({
			text: 'Review source',
			status: 'completed',
			attachments: [
				{
					name: 'notes.txt',
					mimeType: 'text/plain',
					size: 5,
					available: false,
					reattachRequired: true
				}
			]
		});
		expect(copied[0]?.id).not.toBe('source-message');
		expect(store.listEvents('hue', 'fork-1').map((event) => event.payload.messageId)).not.toContain(
			'source-message'
		);
		expect(
			store.database
				.query('SELECT data FROM message_attachments WHERE message_id = ?')
				.get(copied[0]!.id)
		).toEqual({ data: '' });
		store.close();
	});

	it('validates all duplicate metadata before a Hermes fork can be requested', () => {
		const store = makeDeliveryStore();
		store.updateSessionMetadata('hue', 'session-1', {
			title: 'x'.repeat(200),
			folder: 'Reviews',
			tags: ['safe']
		});

		expect(() => store.prepareSessionCopy('hue', 'session-1')).toThrow(
			'Session title must be 1-200 characters'
		);
		expect(() => store.prepareSessionCopy('hue', 'session-1', 42)).toThrow(
			'Session title must be 1-200 characters'
		);
		expect(store.prepareSessionCopy('hue', 'session-1', 'Valid copy')).toEqual({
			title: 'Valid copy',
			pinned: false,
			archived: false,
			folder: 'Reviews',
			tags: ['safe']
		});
		store.close();
	});

	it('derives background attention and error indicators from durable state', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'waiting', cwd: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'failed', cwd: '/work/hue' });
		store.appendEvent('hue', 'waiting', 'agent.permission', {
			id: 'permission-1',
			status: 'pending'
		});
		store.acceptMessage({ id: 'msg-failed', projectId: 'hue', sessionId: 'failed', text: 'Run' });
		store.transitionMessage('msg-failed', 'running', { messageId: 'msg-failed' });
		store.transitionMessage('msg-failed', 'failed', {
			messageId: 'msg-failed',
			error: 'Hermes unavailable'
		});

		expect(store.getSessionIndicators('hue')).toEqual({
			waiting: {
				attention: true,
				error: false,
				status: 'waiting-permission',
				unreadAttention: true
			},
			failed: { attention: true, error: true, status: 'failed', unreadAttention: true }
		});
		store.appendEvent('hue', 'waiting', 'agent.permission', {
			id: 'permission-1',
			status: 'resolved'
		});
		expect(store.getSessionIndicators('hue').waiting).toEqual({
			attention: false,
			error: false,
			status: null,
			unreadAttention: true
		});
		store.close();
	});

	it('stores a session and its delivery state without a project', () => {
		const store = makeStore();
		store.upsertSession(null, { sessionId: 'session-1', cwd: '/work/topics' });

		expect(store.hasSession(null, 'session-1')).toBe(true);
		store.acceptMessage({
			id: 'msg-1',
			projectId: null,
			sessionId: 'session-1',
			text: 'Keep this topic independent.'
		});
		expect(store.getSessionSnapshot(null, 'session-1').messages).toEqual([
			expect.objectContaining({ id: 'msg-1', projectId: null })
		]);
		store.close();
	});

	it('persists review contexts as part of the idempotent message envelope', () => {
		const store = makeDeliveryStore();
		const reviewContexts = [
			{
				id: 'review-1',
				source: 'assistant' as const,
				label: 'Hermes response',
				content: 'Use the shared validator.',
				comment: 'Keep this in the final change.'
			}
		];
		const envelope = {
			id: 'msg-review',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Apply the review.',
			reviewContexts
		};

		store.acceptMessage(envelope);
		expect(store.getMessage(envelope.id)?.reviewContexts).toEqual(reviewContexts);
		expect(store.acceptMessage(envelope)).toEqual({ duplicate: true, status: 'queued' });
		expect(() =>
			store.acceptMessage({
				...envelope,
				reviewContexts: [{ ...reviewContexts[0], comment: 'Different envelope' }]
			})
		).toThrow(MessageConflictError);
		store.close();
	});

	it('lists workflows only for the selected project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'notidian', name: 'Notidian', rootPath: '/work/notidian' });
		store.createWorkflow({
			id: 'build',
			projectId: 'hue',
			name: 'Build next slice',
			prompt: 'Implement the next verified HUE slice.'
		});
		store.createWorkflow({
			id: 'review',
			projectId: 'notidian',
			name: 'Review notes',
			prompt: 'Review pending notes.'
		});

		expect(store.listProjects().map((project) => project.id)).toEqual(['hue', 'notidian']);
		expect(store.listWorkflows('hue').map((workflow) => workflow.id)).toEqual(['build']);
		expect(store.listWorkflows('notidian').map((workflow) => workflow.id)).toEqual(['review']);

		store.close();
	});

	it('updates, archives, restores, and deletes workflows inside their project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createWorkflow({
			id: 'release',
			projectId: 'hue',
			name: 'Prepare release',
			prompt: 'Run release checks.',
			profile: 'work',
			workMode: 'live',
			folder: 'Release',
			favorite: true
		});

		expect(
			store.updateWorkflow('hue', 'release', {
				name: 'Ship release',
				prompt: 'Run checks and prepare release notes.',
				profile: 'default',
				workMode: 'autonomous',
				archived: true
			})
		).toMatchObject({
			id: 'release',
			projectId: 'hue',
			name: 'Ship release',
			profile: 'default',
			workMode: 'autonomous',
			archived: true
		});
		expect(store.listWorkflows('hue')).toEqual([]);
		expect(store.listWorkflows('hue', true)).toEqual([
			expect.objectContaining({ id: 'release', archived: true })
		]);
		expect(store.listWorkflows('hue', true)[0]).toMatchObject({
			folder: 'Release',
			favorite: true
		});
		expect(store.updateWorkflow('hue', 'release', { folder: null })?.folder).toBeNull();
		expect(store.updateWorkflow('hue', 'release', { favorite: false })?.favorite).toBe(false);

		expect(store.updateWorkflow('hue', 'release', { archived: false })).toMatchObject({
			archived: false
		});
		expect(store.deleteWorkflow('hue', 'release')).toBe(true);
		expect(store.listWorkflows('hue', true)).toEqual([]);
		store.close();
	});

	it('does not mutate a workflow through another project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'other', name: 'Other', rootPath: '/work/other' });
		store.createWorkflow({
			id: 'release',
			projectId: 'hue',
			name: 'Prepare release',
			prompt: 'Run release checks.'
		});

		expect(store.updateWorkflow('other', 'release', { name: 'Wrong' })).toBeNull();
		expect(store.deleteWorkflow('other', 'release')).toBe(false);
		expect(store.listWorkflows('hue')).toEqual([
			expect.objectContaining({ id: 'release', name: 'Prepare release' })
		]);
		store.close();
	});

	it('updates project names and icons, then removes projects', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Project-scoped message.'
		});
		store.updateMessageStatus('msg-1', 'failed');

		expect(store.updateProject('hue', { name: 'Hue workspace', icon: '🚀' })).toMatchObject({
			id: 'hue',
			name: 'Hue workspace',
			icon: '🚀',
			rootPath: '/work/hue'
		});
		expect(store.deleteProject('hue')).toBe(true);
		expect(store.listProjects()).toEqual([]);
		expect(store.database.query('SELECT COUNT(*) AS count FROM messages').get()).toEqual({
			count: 0
		});
		expect(store.database.query('SELECT COUNT(*) AS count FROM session_events').get()).toEqual({
			count: 0
		});
		expect(store.deleteProject('hue')).toBe(false);
		store.close();
	});

	it('refuses to remove a project with active deliveries', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Do not lose this.'
		});

		expect(() => store.deleteProject('hue')).toThrow('active message deliveries');
		expect(store.getProject('hue')).not.toBeNull();
		expect(store.getMessage('msg-1')?.status).toBe('queued');
		store.close();
	});

	it('reports unresolved Project delivery without deleting HUE metadata', () => {
		const store = makeDeliveryStore();
		expect(store.hasActiveProjectDeliveries('hue')).toBe(false);
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Keep delivery state.'
		});
		expect(store.hasActiveProjectDeliveries('hue')).toBe(true);
		expect(store.getMessage('msg-1')?.status).toBe('queued');
		store.close();
	});

	it('stores a custom session icon without changing Hermes session data', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(store.updateSessionIcon('hue', 'session-1', '🐛')).toBe(true);
		expect(store.getSession('hue', 'session-1')).toMatchObject({
			sessionId: 'session-1',
			cwd: '/work/hue',
			icon: '🐛'
		});
		store.close();
	});

	it('relocates a Project without rewriting Hermes-owned Session cwd', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/HUE-bun-workspace' });
		store.upsertSession('hue', {
			sessionId: 'project-session',
			cwd: '/work/HUE-bun-workspace'
		});
		store.upsertSession(null, { sessionId: 'projectless-session', cwd: '/private/hue/sessions' });

		expect(store.relocateProject('hue', '/work/HUE')).toMatchObject({
			id: 'hue',
			rootPath: '/work/HUE'
		});
		expect(store.getSession('hue', 'project-session')?.cwd).toBe('/work/HUE-bun-workspace');
		expect(store.getSession(null, 'projectless-session')?.cwd).toBe('/private/hue/sessions');
		store.close();
	});

	it('refuses to relocate a Project while delivery state is active', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Keep cwd stable while this is queued.'
		});

		expect(() => store.relocateProject('hue', '/work/moved-hue')).toThrow(
			'active message deliveries'
		);
		expect(store.getProject('hue')?.rootPath).toBe('/work/hue');
		store.close();
	});

	it('allows stale Project recovery without erasing unknown delivery truth', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Outcome is unknown.'
		});
		store.updateMessageStatus('msg-1', 'running');
		store.updateMessageStatus('msg-1', 'unknown');

		expect(store.relocateProject('hue', '/work/recovered-hue')?.rootPath).toBe(
			'/work/recovered-hue'
		);
		expect(store.getMessage('msg-1')?.status).toBe('unknown');
		expect(store.getSession('hue', 'session-1')?.cwd).toBe('/work/hue');
		store.close();
	});
});

describe('HUEStore acknowledged message transport', () => {
	it('binds messages and events to their associated project and session', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'other', name: 'Other', rootPath: '/work/other' });
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Project-scoped message.'
		});

		expect(store.hasSession('hue', 'session-1')).toBe(true);
		expect(store.hasSession('other', 'session-1')).toBe(false);
		expect(store.listMessages('hue', 'session-1')).toHaveLength(1);
		expect(store.listMessages('other', 'session-1')).toEqual([]);
		expect(store.listEvents('other', 'session-1')).toEqual([]);
		store.close();
	});

	it('rejects moving an existing session to another project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'other', name: 'Other', rootPath: '/work/other' });
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(() =>
			store.upsertSession('other', { sessionId: 'session-1', cwd: '/work/other' })
		).toThrow('already belongs to Project hue');
		expect(store.hasSession('hue', 'session-1')).toBe(true);
		expect(store.hasSession('other', 'session-1')).toBe(false);
		store.close();
	});

	it('refuses delivery state for an unassociated session', () => {
		const store = makeDeliveryStore();

		expect(() =>
			store.acceptMessage({
				id: 'msg-other',
				projectId: 'hue',
				sessionId: 'other-session',
				text: 'Do not persist this.'
			})
		).toThrow('Session other-session is not associated with Project hue');
		store.close();
	});

	it('migrates legacy delivery rows and backfills them when their session is discovered', () => {
		const filename = join(tmpdir(), `hue-store-${crypto.randomUUID()}.db`);
		temporaryDatabases.push(filename);
		const legacy = new Database(filename, { create: true });
		legacy.exec(`
			CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
			CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE session_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
			INSERT INTO projects VALUES ('hue', 'HUE', '/work/hue', '2026-08-21T00:00:00.000Z');
			INSERT INTO messages VALUES ('msg-1', 'session-1', 'Preserve me', 'queued', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
			INSERT INTO session_events (session_id, type, payload, created_at) VALUES ('session-1', 'message.accepted', '{"messageId":"msg-1"}', '2026-08-21T00:00:00.000Z');
		`);
		legacy.close();

		const store = new HUEStore(filename);
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(store.listMessages('hue', 'session-1')).toEqual([
			expect.objectContaining({ id: 'msg-1', text: 'Preserve me', projectId: 'hue' })
		]);
		expect(store.listEvents('hue', 'session-1')).toHaveLength(1);
		store.close();
	});
	it('migrates delivery status for cancelled turns without losing attachments', () => {
		const filename = join(tmpdir(), `hue-store-${crypto.randomUUID()}.db`);
		temporaryDatabases.push(filename);
		const legacy = new Database(filename, { create: true });
		legacy.exec(`
			CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
			CREATE TABLE project_sessions (session_id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), cwd TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE messages (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), session_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unknown')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE message_attachments (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, data TEXT NOT NULL, size INTEGER, PRIMARY KEY (message_id, position));
			INSERT INTO projects VALUES ('hue', 'HUE', '/work/hue', '2026-08-21T00:00:00.000Z');
			INSERT INTO project_sessions VALUES ('session-1', 'hue', '/work/hue', '2026-08-21T00:00:00.000Z');
			INSERT INTO messages VALUES ('msg-1', 'hue', 'session-1', 'Stop me', 'running', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
			INSERT INTO message_attachments VALUES ('msg-1', 0, 'note.txt', 'text/plain', 'aGVsbG8=', 5);
		`);
		legacy.close();

		const store = new HUEStore(filename);
		store.transitionCancelledMessage('msg-1');

		expect(store.getMessage('msg-1')).toMatchObject({
			status: 'cancelled',
			attachments: [expect.objectContaining({ name: 'note.txt', size: 5 })]
		});
		store.close();
	});
	it('persists the complete text before accepting a message', () => {
		const store = makeDeliveryStore();
		const text = 'This message includes emoji 🧭 and a final sentence that must not disappear.';

		const accepted = store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text
		});

		expect(accepted).toMatchObject({ duplicate: false, status: 'queued' });
		expect(store.getMessage('msg-1')).toMatchObject({ text, status: 'queued' });
		store.close();
	});

	it('deduplicates an identical retried envelope', () => {
		const store = makeDeliveryStore();
		const envelope = {
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Send this once.'
		};

		store.acceptMessage(envelope);
		const retried = store.acceptMessage(envelope);

		expect(retried).toMatchObject({ duplicate: true, status: 'queued' });
		expect(store.listMessages('hue', 'session-1')).toHaveLength(1);
		store.close();
	});

	it('edits only messages that are still queued', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Original'
		});

		store.updateQueuedMessage('msg-1', {
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Edited before delivery',
			images: [{ name: 'updated.png', mimeType: 'image/png', data: 'aGVsbG8=' }]
		});

		expect(store.getMessage('msg-1')).toMatchObject({
			text: 'Edited before delivery',
			images: [{ name: 'updated.png', mimeType: 'image/png', data: 'aGVsbG8=' }]
		});
		store.updateMessageStatus('msg-1', 'running');
		expect(() =>
			store.updateQueuedMessage('msg-1', {
				projectId: 'hue',
				sessionId: 'session-1',
				text: 'Too late',
				images: []
			})
		).toThrow('Message msg-1 is no longer queued');
		store.close();
	});

	it('persists generic attachment metadata but never payload bytes', () => {
		const store = makeDeliveryStore();
		const attachment = {
			name: 'notes.md',
			mimeType: 'text/markdown',
			size: 5,
			data: 'aGVsbG8='
		};

		store.acceptMessage({
			id: 'msg-file',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review attached notes',
			attachments: [attachment]
		});

		const unavailable = {
			name: attachment.name,
			mimeType: attachment.mimeType,
			size: attachment.size,
			available: false,
			reattachRequired: true
		};
		expect(store.getMessage('msg-file')?.attachments).toEqual([unavailable]);
		expect(store.recoverInterruptedMessages()[0]?.attachments).toEqual([unavailable]);
		expect(
			store.database
				.query('SELECT data FROM message_attachments WHERE message_id = ?')
				.get('msg-file')
		).toEqual({ data: '' });
		store.updateQueuedMessage('msg-file', {
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review updated notes',
			images: [],
			attachments: [attachment]
		});
		expect(store.getSessionSnapshot('hue', 'session-1').messages[0]?.attachments).toEqual([
			unavailable
		]);
		store.close();
	});

	it('keeps the running message active when a follow-up is queued', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({ id: 'active', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		store.updateMessageStatus('active', 'running');
		store.acceptMessage({ id: 'queued', projectId: 'hue', sessionId: 'session-1', text: 'Next' });

		expect(store.getSessionSnapshot('hue', 'session-1').activeTurn?.messageId).toBe('active');
		store.close();
	});

	it('rejects reuse of a message id with different content', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Original full text.'
		});

		expect(() =>
			store.acceptMessage({
				id: 'msg-1',
				projectId: 'hue',
				sessionId: 'session-1',
				text: 'Truncated'
			})
		).toThrow(MessageConflictError);
		store.close();
	});

	it('replays monotonic events after the reconnect cursor', () => {
		const store = makeDeliveryStore();
		store.appendEvent('hue', 'session-1', 'message.accepted', { messageId: 'msg-1' });
		const second = store.appendEvent('hue', 'session-1', 'agent.chunk', { text: 'Hello' });
		store.appendEvent('hue', 'session-1', 'agent.completed', { messageId: 'msg-1' });

		const replay = store.listEvents('hue', 'session-1', second.sequence);

		expect(replay).toHaveLength(1);
		expect(replay[0]).toMatchObject({ sequence: 3, type: 'agent.completed' });
		store.close();
	});

	it('recursively redacts credential identifiers and credential text at event persistence', () => {
		const store = makeDeliveryStore();
		const event = store.appendEvent('hue', 'session-1', 'agent.tool', {
			messageId: 'msg-1',
			title: 'Authorization: Bearer title-secret',
			args: {
				OPENAI_API_KEY: 'openai-secret',
				GH_TOKEN: 'github-secret',
				AWS_SECRET_ACCESS_KEY: 'aws-secret',
				DEPLOY_TOKEN: 'deploy-secret',
				SIGNING_SECRET: 'signing-secret',
				ADMIN_PASSWORD: 'password-secret',
				command:
					'curl -H "Authorization: Bearer header-secret" https://user:pass@example.test && export OPENAI_API_KEY=inline-secret'
			},
			result: ['Bearer result-secret', { error: 'GH_TOKEN=result-token' }],
			plan: [{ content: 'Use AWS_SECRET_ACCESS_KEY=plan-secret' }],
			children: [
				{ goal: 'Check https://alice:hunter2@example.test', result: 'token=result-secret' }
			],
			safe: {
				tokenCount: 42,
				passwordless: true,
				secretariat: 'office',
				authorizationMode: 'explicit',
				url: 'https://example.test/path',
				prose: 'Bearer authentication uses a credential.'
			}
		});

		expect(JSON.stringify(event.payload)).not.toContain('title-secret');
		expect(JSON.stringify(event.payload)).not.toContain('openai-secret');
		expect(JSON.stringify(event.payload)).not.toContain('github-secret');
		expect(JSON.stringify(event.payload)).not.toContain('aws-secret');
		expect(JSON.stringify(event.payload)).not.toContain('header-secret');
		expect(JSON.stringify(event.payload)).not.toContain('hunter2');
		expect(event.payload).toMatchObject({
			title: 'Authorization: [REDACTED]',
			args: {
				OPENAI_API_KEY: '[REDACTED]',
				GH_TOKEN: '[REDACTED]',
				AWS_SECRET_ACCESS_KEY: '[REDACTED]',
				DEPLOY_TOKEN: '[REDACTED]',
				SIGNING_SECRET: '[REDACTED]',
				ADMIN_PASSWORD: '[REDACTED]'
			},
			safe: {
				tokenCount: 42,
				passwordless: true,
				secretariat: 'office',
				authorizationMode: 'explicit',
				url: 'https://example.test/path',
				prose: 'Bearer authentication uses a credential.'
			}
		});
		expect(store.listEvents('hue', 'session-1').at(-1)?.payload).toEqual(event.payload);
		store.close();
	});

	it('redacts structured set-cookie keys before persisting events', () => {
		const store = makeDeliveryStore();
		store.appendEvent('hue', 'session-1', 'agent.tool', {
			headers: {
				'set-cookie': 'session=dash-secret',
				set_cookie: 'session=underscore-secret',
				'SET-COOKIE': 'session=case-secret',
				'content-type': 'application/json'
			}
		});

		expect(store.listEvents('hue', 'session-1').at(-1)?.payload).toEqual({
			headers: {
				'set-cookie': '[REDACTED]',
				set_cookie: '[REDACTED]',
				'SET-COOKIE': '[REDACTED]',
				'content-type': 'application/json'
			}
		});
		store.close();
	});

	it('uses recursive redaction for every durable interaction payload surface', () => {
		const store = makeDeliveryStore();
		const secret =
			'-----BEGIN RSA PRIVATE KEY-----\npersisted-secret\n-----END RSA PRIVATE KEY-----';
		for (const [type, payload] of [
			[
				'agent.tool',
				{ title: 'Cookie: tool-secret', args: { apiKey: 'args-secret' }, result: secret }
			],
			['agent.subagents', { id: 'delegate', children: [{ goal: 'Safe goal', result: secret }] }],
			[
				'agent.permission',
				{
					id: 'permission',
					toolCall: { title: 'Safe title', args: { clientSecret: 'permission-secret' } }
				}
			],
			[
				'agent.clarify',
				{ id: 'clarify', message: 'Safe question', answer: { password: 'clarify-secret' } }
			],
			['message.failed', { messageId: 'msg-1', error: 'Set-Cookie: failure-secret' }]
		] as const) {
			store.appendEvent('hue', 'session-1', type, payload);
		}

		const persisted = JSON.stringify(store.listEvents('hue', 'session-1'));
		for (const value of [
			'tool-secret',
			'args-secret',
			'persisted-secret',
			'permission-secret',
			'clarify-secret',
			'failure-secret'
		]) {
			expect(persisted).not.toContain(value);
		}
		expect(persisted).toContain('Safe goal');
		expect(persisted).toContain('Safe title');
		expect(persisted).toContain('Safe question');
		store.close();
	});

	it('redaction preserves safe audit history without depth or item truncation', () => {
		const store = makeDeliveryStore();
		let nested: Record<string, unknown> = { value: 'safe' };
		for (let depth = 0; depth < 20; depth += 1) nested = { child: nested };
		const values = Array.from({ length: 250 }, (_, index) => `safe-${index}`);

		const event = store.appendEvent('hue', 'session-1', 'agent.subagents', {
			id: 'delegate-large',
			nested,
			values
		});

		expect(event.payload.values).toEqual(values);
		expect(JSON.stringify(event.payload.nested)).toContain('"value":"safe"');
		expect(JSON.stringify(event.payload)).not.toContain('[TRUNCATED]');
		store.close();
	});

	it('records explicit queued, running, and terminal message states', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Run safely.'
		});
		store.updateMessageStatus('msg-1', 'running');
		expect(store.getMessage('msg-1')?.status).toBe('running');
		store.updateMessageStatus('msg-1', 'completed');
		expect(store.getMessage('msg-1')?.status).toBe('completed');

		expect(() => store.updateMessageStatus('msg-1', 'running')).toThrow(
			'Cannot transition message msg-1 from completed to running'
		);
		store.close();
	});

	it('rolls back a status change when its event cannot be persisted', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Stay queued.'
		});

		expect(() => store.transitionMessage('msg-1', 'running', { invalid: 1n })).toThrow();
		expect(store.getMessage('msg-1')?.status).toBe('queued');
		expect(store.listEvents('hue', 'session-1').map((event) => event.type)).toEqual([
			'message.accepted'
		]);
		store.close();
	});

	it('atomically emits the semantic event corresponding to the new status', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Run once.'
		});

		store.transitionMessage('msg-1', 'running', { messageId: 'msg-1' });

		expect(store.getMessage('msg-1')?.status).toBe('running');
		expect(store.listEvents('hue', 'session-1').at(-1)?.type).toBe('message.running');
		store.close();
	});

	it('returns messages, events, and reconnect cursor in one session snapshot', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Keep my state.'
		});
		store.updateMessageStatus('msg-1', 'running');
		store.appendEvent('hue', 'session-1', 'message.running', { messageId: 'msg-1' });
		store.appendEvent('hue', 'session-1', 'agent.thought', {
			messageId: 'msg-1',
			text: 'Inspecting state. '
		});
		store.appendEvent('hue', 'session-1', 'agent.chunk', {
			messageId: 'msg-1',
			text: 'Still working'
		});
		store.appendEvent('hue', 'session-1', 'agent.image', {
			messageId: 'msg-1',
			image: { name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' }
		});

		const snapshot = store.getSessionSnapshot('hue', 'session-1');

		expect(snapshot.messages).toEqual([
			expect.objectContaining({ id: 'msg-1', status: 'running', text: 'Keep my state.' })
		]);
		expect(snapshot.events.map((event) => event.type)).toEqual([
			'message.accepted',
			'message.running',
			'agent.thought',
			'agent.chunk',
			'agent.image'
		]);
		expect(snapshot.cursor).toBe(snapshot.events.at(-1)!.sequence);
		expect(snapshot.activeTurn).toEqual({
			messageId: 'msg-1',
			status: 'running',
			thought: 'Inspecting state. ',
			output: 'Still working',
			images: [{ name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' }],
			error: null
		});
		store.close();
	});

	it('reconstructs unknown delivery without making it runnable again', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Never auto-retry me.'
		});
		store.updateMessageStatus('msg-1', 'running');
		store.updateMessageStatus('msg-1', 'unknown');
		store.appendEvent('hue', 'session-1', 'message.unknown', {
			messageId: 'msg-1',
			error: 'ACP disconnected before acknowledgement'
		});

		expect(store.getSessionSnapshot('hue', 'session-1').activeTurn).toEqual({
			messageId: 'msg-1',
			status: 'unknown',
			thought: '',
			output: '',
			images: [],
			error: 'ACP disconnected before acknowledgement'
		});
		store.close();
	});

	it('cancels persisted authority prompts when recovering an interrupted turn', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Ask before acting.'
		});
		store.updateMessageStatus('msg-1', 'running');
		store.appendEvent('hue', 'session-1', 'agent.permission', {
			id: 'permission-1',
			messageId: 'msg-1',
			status: 'pending'
		});
		store.appendEvent('hue', 'session-1', 'agent.clarify', {
			id: 'clarify-1',
			messageId: 'msg-1',
			status: 'pending'
		});

		store.recoverInterruptedMessages();

		const interactions = store
			.listEvents('hue', 'session-1')
			.filter((event) => event.type === 'agent.permission' || event.type === 'agent.clarify');
		expect(
			interactions.map((event) => [event.type, event.payload.id, event.payload.status])
		).toEqual([
			['agent.permission', 'permission-1', 'pending'],
			['agent.clarify', 'clarify-1', 'pending'],
			['agent.permission', 'permission-1', 'cancelled'],
			['agent.clarify', 'clarify-1', 'cancelled']
		]);
		store.close();
	});

	it('uses accepted event order when active messages share a timestamp', () => {
		const store = makeDeliveryStore();
		store.acceptMessage({ id: 'z-first', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		store.acceptMessage({
			id: 'a-second',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Second'
		});
		store.database.query("UPDATE messages SET created_at = '2026-08-21T12:00:00.000Z'").run();

		expect(store.getSessionSnapshot('hue', 'session-1').activeTurn?.messageId).toBe('a-second');
		store.close();
	});

	it('lists start times only for queued and running sessions', () => {
		const store = makeDeliveryStore();
		store.upsertSession('hue', { sessionId: 'session-2', cwd: '/work/hue' });
		store.acceptMessage({ id: 'queued', projectId: 'hue', sessionId: 'session-1', text: 'Wait' });
		store.acceptMessage({ id: 'done', projectId: 'hue', sessionId: 'session-2', text: 'Finish' });
		store.updateMessageStatus('done', 'running');
		store.updateMessageStatus('done', 'completed');

		expect(store.getBusySessionStarts('hue')).toEqual({
			'session-1': store.getMessage('queued')!.createdAt
		});
		store.close();
	});
});

describe('HUEStore Hermes Project identity migration', () => {
	it('persists, trims, removes, and validates HUE-owned Project groups', () => {
		const store = makeStore();
		store.ensureProjectMetadata('p_grouped');

		store.updateProjectGroup('p_grouped', '  Client work  ');
		expect(store.getProjectGroup('p_grouped')).toBe('Client work');
		store.updateProjectGroup('p_grouped', '   ');
		expect(store.getProjectGroup('p_grouped')).toBeNull();
		expect(() => store.updateProjectGroup('missing', 'Client work')).toThrow(
			'Project metadata was not found'
		);
		expect(() => store.getProjectGroup('missing')).toThrow('Project metadata was not found');
		expect(() => store.updateProjectGroup('p_grouped', 'x'.repeat(101))).toThrow(
			'Project group is invalid'
		);
		expect(() => store.updateProjectGroup('p_grouped', 'bad\0group')).toThrow(
			'Project group is invalid'
		);
		store.close();
	});

	it('marks pre-Hermes Project rows as legacy reconciliation inputs', () => {
		const filename = join(tmpdir(), `hue-store-${crypto.randomUUID()}.db`);
		temporaryDatabases.push(filename);
		const legacy = new Database(filename, { create: true });
		legacy.exec(`
			CREATE TABLE projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				root_path TEXT NOT NULL UNIQUE,
				icon TEXT,
				created_at TEXT NOT NULL
			);
			INSERT INTO projects VALUES ('legacy-hue', 'HUE', '/work/hue', '🟣', '2026-08-21T00:00:00.000Z');
		`);
		legacy.close();

		const store = new HUEStore(filename);

		expect(store.listLegacyProjects()).toEqual([
			{
				id: 'legacy-hue',
				name: 'HUE',
				rootPath: '/work/hue',
				icon: '🟣',
				createdAt: '2026-08-21T00:00:00.000Z'
			}
		]);
		store.close();
	});

	it('remaps every HUE-owned foreign key to Hermes id without losing unknown delivery state', () => {
		const store = makeStore();
		store.createProject({ id: 'legacy-hue', name: 'HUE', rootPath: '/work/hue' });
		store.updateProjectGroup('legacy-hue', 'Core');
		store.createWorkflow({
			id: 'workflow-1',
			projectId: 'legacy-hue',
			name: 'Ship',
			prompt: 'Ship safely.'
		});
		store.upsertSession('legacy-hue', { sessionId: 'session-1', cwd: '/work/hue/packages/app' });
		store.acceptMessage({
			id: 'message-1',
			projectId: 'legacy-hue',
			sessionId: 'session-1',
			text: 'Preserve delivery truth.'
		});
		store.updateMessageStatus('message-1', 'running');
		store.updateMessageStatus('message-1', 'unknown');
		store.updateProjectExcalidraw('legacy-hue', {
			scene: '{"version":1,"elements":[],"appState":{}}'
		});
		store.database
			.query(
				'INSERT INTO dismissed_sessions (project_scope, session_id, dismissed_at) VALUES (?, ?, ?)'
			)
			.run('legacy-hue', 'dismissed-session', '2026-08-21T00:00:00.000Z');

		store.adoptHermesProject('legacy-hue', 'p_hermes');

		expect(store.listLegacyProjects()).toEqual([]);
		expect(store.hasProjectMetadata('legacy-hue')).toBe(false);
		expect(store.hasProjectMetadata('p_hermes')).toBe(true);
		expect(store.getProjectGroup('p_hermes')).toBe('Core');
		expect(store.listWorkflows('p_hermes').map(({ id }) => id)).toEqual(['workflow-1']);
		expect(store.getSession('p_hermes', 'session-1')?.cwd).toBe('/work/hue/packages/app');
		expect(store.getMessage('message-1')).toMatchObject({
			projectId: 'p_hermes',
			status: 'unknown'
		});
		expect(store.listEvents('p_hermes', 'session-1').length).toBeGreaterThan(0);
		expect(store.getProjectExcalidraw('p_hermes')?.scene).toContain('"version":1');
		expect(store.isSessionDismissed('p_hermes', 'dismissed-session')).toBe(true);
		expect(store.database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		store.close();
	});
});
