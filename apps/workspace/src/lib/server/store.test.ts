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
	store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	return store;
}

describe('HUEStore project and workflow boundaries', () => {
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
});

describe('HUEStore acknowledged message transport', () => {
	it('binds messages and events to their associated project and session', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'other', name: 'Other', rootPath: '/work/other' });
		store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		store.acceptMessage({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Project-scoped message.'
		});

		expect(store.hasProjectSession('hue', 'session-1')).toBe(true);
		expect(store.hasProjectSession('other', 'session-1')).toBe(false);
		expect(store.listMessages('hue', 'session-1')).toHaveLength(1);
		expect(store.listMessages('other', 'session-1')).toEqual([]);
		expect(store.listEvents('other', 'session-1')).toEqual([]);
		store.close();
	});

	it('rejects moving an existing session to another project', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createProject({ id: 'other', name: 'Other', rootPath: '/work/other' });
		store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(() =>
			store.upsertProjectSession('other', { sessionId: 'session-1', cwd: '/work/other' })
		).toThrow('already belongs to Project hue');
		expect(store.hasProjectSession('hue', 'session-1')).toBe(true);
		expect(store.hasProjectSession('other', 'session-1')).toBe(false);
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
		store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(store.listMessages('hue', 'session-1')).toEqual([
			expect.objectContaining({ id: 'msg-1', text: 'Preserve me', projectId: 'hue' })
		]);
		expect(store.listEvents('hue', 'session-1')).toHaveLength(1);
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
		store.appendEvent('hue', 'session-1', 'agent.chunk', {
			messageId: 'msg-1',
			text: 'Still working'
		});

		const snapshot = store.getSessionSnapshot('hue', 'session-1');

		expect(snapshot.messages).toEqual([
			expect.objectContaining({ id: 'msg-1', status: 'running', text: 'Keep my state.' })
		]);
		expect(snapshot.events.map((event) => event.type)).toEqual([
			'message.accepted',
			'message.running',
			'agent.chunk'
		]);
		expect(snapshot.cursor).toBe(snapshot.events.at(-1)!.sequence);
		expect(snapshot.activeTurn).toEqual({
			messageId: 'msg-1',
			status: 'running',
			output: 'Still working',
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
			output: '',
			error: 'ACP disconnected before acknowledgement'
		});
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
});
