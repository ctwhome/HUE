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
			waiting: { attention: true, error: false },
			failed: { attention: true, error: true }
		});
		store.appendEvent('hue', 'waiting', 'agent.permission', {
			id: 'permission-1',
			status: 'resolved'
		});
		expect(store.getSessionIndicators('hue').waiting).toEqual({
			attention: false,
			error: false
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

	it('stores a custom session icon without changing Hermes session data', () => {
		const store = makeStore();
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });

		expect(store.updateSessionIcon('hue', 'session-1', '🐛')).toBe(true);
		expect(store.getSession('hue', 'session-1')).toEqual({
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
