import { createRequire } from 'node:module';
import type { Database as BunDatabase } from 'bun:sqlite';
import type { ImageAttachment } from '$lib/message-content';
import { redactPersistedValue } from './redaction';

const runtimeRequire = createRequire(import.meta.url);

export type MessageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';

export type Project = {
	id: string;
	name: string;
	rootPath: string;
	icon: string | null;
	createdAt: string;
};

export type Workflow = {
	id: string;
	projectId: string;
	name: string;
	prompt: string;
	profile: string;
	createdAt: string;
};

export type StoredMessage = {
	id: string;
	projectId: string | null;
	sessionId: string;
	text: string;
	images: ImageAttachment[];
	status: MessageStatus;
	createdAt: string;
	updatedAt: string;
};

export type SessionEvent = {
	sequence: number;
	projectId: string | null;
	sessionId: string;
	type: string;
	payload: Record<string, unknown>;
	createdAt: string;
};

export class MessageConflictError extends Error {
	constructor(messageId: string) {
		super(`Message id ${messageId} was already used for a different envelope`);
		this.name = 'MessageConflictError';
	}
}

const allowedTransitions: Record<MessageStatus, ReadonlySet<MessageStatus>> = {
	queued: new Set(['running', 'failed']),
	running: new Set(['completed', 'failed', 'unknown']),
	completed: new Set(),
	failed: new Set(),
	unknown: new Set()
};

export class HUEStore {
	readonly database: BunDatabase;

	constructor(filename: string) {
		const { Database } = runtimeRequire('bun:sqlite') as typeof import('bun:sqlite');
		this.database = new Database(filename, { create: true, strict: true });
		this.database.exec('PRAGMA foreign_keys = ON');
		this.migrate();
	}

	private migrate() {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				root_path TEXT NOT NULL UNIQUE,
				icon TEXT,
				created_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS workflows (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				prompt TEXT NOT NULL,
				profile TEXT NOT NULL DEFAULT 'default',
				created_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS workflows_project_id_idx
				ON workflows(project_id, created_at, id);

			CREATE TABLE IF NOT EXISTS project_sessions (
				session_id TEXT PRIMARY KEY,
				project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
				cwd TEXT NOT NULL,
				icon TEXT,
				updated_at TEXT NOT NULL,
				UNIQUE (project_id, session_id)
			);

			CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				text TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unknown')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS message_attachments (
				message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
				position INTEGER NOT NULL,
				name TEXT NOT NULL,
				mime_type TEXT NOT NULL,
				data TEXT NOT NULL,
				PRIMARY KEY (message_id, position)
			);

			CREATE INDEX IF NOT EXISTS messages_session_id_idx
				ON messages(session_id, created_at, id);

			CREATE TABLE IF NOT EXISTS session_events (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL,
				type TEXT NOT NULL,
				payload TEXT NOT NULL,
				created_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS session_events_cursor_idx
				ON session_events(session_id, sequence);
		`);
		const projectColumns = this.database.query('PRAGMA table_info(projects)').all() as Array<{
			name: string;
		}>;
		if (!projectColumns.some((column) => column.name === 'icon')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN icon TEXT');
		}
		let sessionColumns = this.database.query('PRAGMA table_info(project_sessions)').all() as Array<{
			name: string;
			notnull: number;
		}>;
		if (!sessionColumns.some((column) => column.name === 'icon')) {
			this.database.exec('ALTER TABLE project_sessions ADD COLUMN icon TEXT');
			sessionColumns = this.database.query('PRAGMA table_info(project_sessions)').all() as Array<{
				name: string;
				notnull: number;
			}>;
		}
		if (sessionColumns.find((column) => column.name === 'project_id')?.notnull) {
			this.database.transaction(() => {
				this.database.exec(`
					CREATE TABLE project_sessions_migrated (
						session_id TEXT PRIMARY KEY,
						project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
						cwd TEXT NOT NULL,
						icon TEXT,
						updated_at TEXT NOT NULL
					);
					INSERT INTO project_sessions_migrated (session_id, project_id, cwd, icon, updated_at)
						SELECT session_id, project_id, cwd, icon, updated_at FROM project_sessions;
					DROP TABLE project_sessions;
					ALTER TABLE project_sessions_migrated RENAME TO project_sessions;
				`);
			})();
			sessionColumns = this.database.query('PRAGMA table_info(project_sessions)').all() as Array<{
				name: string;
				notnull: number;
			}>;
		}
		const messageColumns = this.database.query('PRAGMA table_info(messages)').all() as Array<{
			name: string;
		}>;
		if (!messageColumns.some((column) => column.name === 'project_id')) {
			this.database.exec('ALTER TABLE messages ADD COLUMN project_id TEXT REFERENCES projects(id)');
		}
		const eventColumns = this.database.query('PRAGMA table_info(session_events)').all() as Array<{
			name: string;
		}>;
		if (!eventColumns.some((column) => column.name === 'project_id')) {
			this.database.exec(
				'ALTER TABLE session_events ADD COLUMN project_id TEXT REFERENCES projects(id)'
			);
		}
		this.database.exec(`
			CREATE INDEX IF NOT EXISTS messages_project_session_idx
				ON messages(project_id, session_id, created_at, id);
			CREATE INDEX IF NOT EXISTS session_events_project_cursor_idx
				ON session_events(project_id, session_id, sequence);
		`);
	}

	upsertSession(projectId: string | null, session: { sessionId: string; cwd: string }): void {
		const existing = this.database
			.query('SELECT project_id FROM project_sessions WHERE session_id = ?')
			.get(session.sessionId) as { project_id: string | null } | null;
		if (existing && existing.project_id !== projectId) {
			throw new Error(
				`Session ${session.sessionId} already belongs to ${existing.project_id ? `Project ${existing.project_id}` : 'No project'}`
			);
		}
		const now = new Date().toISOString();
		this.database.transaction(() => {
			this.database
				.query(
					`INSERT INTO project_sessions (session_id, project_id, cwd, updated_at)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(session_id) DO UPDATE SET
					 project_id = excluded.project_id, cwd = excluded.cwd, updated_at = excluded.updated_at`
				)
				.run(session.sessionId, projectId, session.cwd, now);
			if (projectId) {
				this.database
					.query('UPDATE messages SET project_id = ? WHERE session_id = ? AND project_id IS NULL')
					.run(projectId, session.sessionId);
				this.database
					.query(
						'UPDATE session_events SET project_id = ? WHERE session_id = ? AND project_id IS NULL'
					)
					.run(projectId, session.sessionId);
			}
		})();
	}

	hasSession(projectId: string | null, sessionId: string): boolean {
		return !!this.database
			.query('SELECT 1 FROM project_sessions WHERE project_id IS ? AND session_id = ?')
			.get(projectId, sessionId);
	}

	getSession(
		projectId: string | null,
		sessionId: string
	): { sessionId: string; cwd: string; icon: string | null } | null {
		const row = this.database
			.query(
				'SELECT session_id, cwd, icon FROM project_sessions WHERE project_id IS ? AND session_id = ?'
			)
			.get(projectId, sessionId) as { session_id: string; cwd: string; icon: string | null } | null;
		return row ? { sessionId: row.session_id, cwd: row.cwd, icon: row.icon } : null;
	}

	listStoredSessions(projectId: string | null): Array<{
		sessionId: string;
		cwd: string;
		icon: string | null;
	}> {
		const rows = this.database
			.query(
				'SELECT session_id, cwd, icon FROM project_sessions WHERE project_id IS ? ORDER BY updated_at DESC, session_id'
			)
			.all(projectId) as Array<{ session_id: string; cwd: string; icon: string | null }>;
		return rows.map((row) => ({ sessionId: row.session_id, cwd: row.cwd, icon: row.icon }));
	}

	updateSessionIcon(projectId: string | null, sessionId: string, icon: string | null): boolean {
		return (
			this.database
				.query('UPDATE project_sessions SET icon = ? WHERE project_id IS ? AND session_id = ?')
				.run(icon, projectId, sessionId).changes > 0
		);
	}

	recoverInterruptedMessages(
		activeMessageIds: ReadonlySet<string> = new Set()
	): Array<StoredMessage & { cwd: string }> {
		return this.database.transaction(() => {
			const running = this.database
				.query(
					`SELECT m.id, m.project_id, m.session_id FROM messages m
					 JOIN project_sessions ps ON ps.project_id IS m.project_id AND ps.session_id = m.session_id
					 WHERE m.status = 'running'`
				)
				.all() as Array<{ id: string; project_id: string | null; session_id: string }>;
			for (const message of running) {
				if (activeMessageIds.has(message.id)) continue;
				this.transitionMessage(message.id, 'unknown', {
					messageId: message.id,
					error: 'HUE restarted during Hermes delivery'
				});
			}

			const queued = this.database
				.query(
					`SELECT m.id, m.project_id, m.session_id, m.text, m.status, m.created_at, m.updated_at, ps.cwd
					 FROM messages m
					 JOIN project_sessions ps ON ps.project_id IS m.project_id AND ps.session_id = m.session_id
					 WHERE m.status = 'queued'
					 ORDER BY m.created_at, m.id`
				)
				.all() as Array<{
				id: string;
				project_id: string | null;
				session_id: string;
				text: string;
				status: MessageStatus;
				created_at: string;
				updated_at: string;
				cwd: string;
			}>;
			return queued.map((row) => ({ ...this.mapMessage(row), cwd: row.cwd }));
		})();
	}

	createProject(input: { id: string; name: string; rootPath: string }): Project {
		const createdAt = new Date().toISOString();
		this.database
			.query('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
			.run(input.id, input.name, input.rootPath, createdAt);
		return { ...input, icon: null, createdAt };
	}

	listProjects(): Project[] {
		const rows = this.database
			.query('SELECT id, name, root_path, icon, created_at FROM projects ORDER BY created_at, id')
			.all() as Array<{
			id: string;
			name: string;
			root_path: string;
			icon: string | null;
			created_at: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			rootPath: row.root_path,
			icon: row.icon,
			createdAt: row.created_at
		}));
	}

	getProject(id: string): Project | null {
		const row = this.database
			.query('SELECT id, name, root_path, icon, created_at FROM projects WHERE id = ?')
			.get(id) as {
			id: string;
			name: string;
			root_path: string;
			icon: string | null;
			created_at: string;
		} | null;
		return row
			? {
					id: row.id,
					name: row.name,
					rootPath: row.root_path,
					icon: row.icon,
					createdAt: row.created_at
				}
			: null;
	}

	updateProject(
		id: string,
		input: { name: string; icon: string | null; rootPath?: string }
	): Project | null {
		return this.database.transaction(() => {
			const project = this.getProject(id);
			if (!project) return null;
			const rootPath = input.rootPath ?? project.rootPath;
			if (rootPath !== project.rootPath) {
				const active = this.database
					.query(
						"SELECT 1 FROM messages WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1"
					)
					.get(id);
				if (active) throw new Error('Project has active message deliveries');
			}
			this.database
				.query('UPDATE projects SET name = ?, icon = ?, root_path = ? WHERE id = ?')
				.run(input.name, input.icon, rootPath, id);
			return this.getProject(id);
		})();
	}

	relocateProject(id: string, rootPath: string): Project | null {
		const project = this.getProject(id);
		return project ? this.updateProject(id, { ...project, rootPath }) : null;
	}

	deleteProject(id: string): boolean {
		return this.database.transaction(() => {
			const active = this.database
				.query(
					"SELECT 1 FROM messages WHERE project_id = ? AND status IN ('queued', 'running', 'unknown') LIMIT 1"
				)
				.get(id);
			if (active) throw new Error('Project has active message deliveries');
			this.database.query('DELETE FROM session_events WHERE project_id = ?').run(id);
			this.database.query('DELETE FROM messages WHERE project_id = ?').run(id);
			return this.database.query('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
		})();
	}

	createWorkflow(input: {
		id: string;
		projectId: string;
		name: string;
		prompt: string;
		profile?: string;
	}): Workflow {
		const createdAt = new Date().toISOString();
		const profile = input.profile ?? 'default';
		this.database
			.query(
				'INSERT INTO workflows (id, project_id, name, prompt, profile, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(input.id, input.projectId, input.name, input.prompt, profile, createdAt);
		return { ...input, profile, createdAt };
	}

	listWorkflows(projectId: string): Workflow[] {
		const rows = this.database
			.query(
				'SELECT id, project_id, name, prompt, profile, created_at FROM workflows WHERE project_id = ? ORDER BY created_at, id'
			)
			.all(projectId) as Array<{
			id: string;
			project_id: string;
			name: string;
			prompt: string;
			profile: string;
			created_at: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			projectId: row.project_id,
			name: row.name,
			prompt: row.prompt,
			profile: row.profile,
			createdAt: row.created_at
		}));
	}

	acceptMessage(input: {
		id: string;
		projectId: string | null;
		sessionId: string;
		text: string;
		images?: ImageAttachment[];
	}): {
		duplicate: boolean;
		status: MessageStatus;
	} {
		if (!this.hasSession(input.projectId, input.sessionId)) {
			throw new Error(
				`Session ${input.sessionId} is not associated with ${input.projectId ? `Project ${input.projectId}` : 'No project'}`
			);
		}
		const existing = this.getMessage(input.id);
		const images = input.images ?? [];
		if (existing) {
			if (
				existing.projectId !== input.projectId ||
				existing.sessionId !== input.sessionId ||
				existing.text !== input.text ||
				JSON.stringify(existing.images) !== JSON.stringify(images)
			) {
				throw new MessageConflictError(input.id);
			}
			return { duplicate: true, status: existing.status };
		}

		const now = new Date().toISOString();
		this.database.transaction(() => {
			this.database
				.query(
					'INSERT INTO messages (id, project_id, session_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
				)
				.run(input.id, input.projectId, input.sessionId, input.text, 'queued', now, now);
			const insertAttachment = this.database.query(
				'INSERT INTO message_attachments (message_id, position, name, mime_type, data) VALUES (?, ?, ?, ?, ?)'
			);
			for (const [position, image] of images.entries()) {
				insertAttachment.run(input.id, position, image.name, image.mimeType, image.data);
			}
			this.database
				.query(
					'INSERT INTO session_events (project_id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
				)
				.run(
					input.projectId,
					input.sessionId,
					'message.accepted',
					JSON.stringify({ messageId: input.id }),
					now
				);
		})();
		return { duplicate: false, status: 'queued' };
	}

	getMessage(id: string): StoredMessage | null {
		const row = this.database
			.query(
				'SELECT id, project_id, session_id, text, status, created_at, updated_at FROM messages WHERE id = ?'
			)
			.get(id) as {
			id: string;
			project_id: string | null;
			session_id: string;
			text: string;
			status: MessageStatus;
			created_at: string;
			updated_at: string;
		} | null;
		return row ? this.mapMessage(row) : null;
	}

	listMessages(projectId: string | null, sessionId: string): StoredMessage[] {
		const rows = this.database
			.query(
				'SELECT id, project_id, session_id, text, status, created_at, updated_at FROM messages WHERE project_id IS ? AND session_id = ? ORDER BY created_at, id'
			)
			.all(projectId, sessionId) as Array<{
			id: string;
			project_id: string | null;
			session_id: string;
			text: string;
			status: MessageStatus;
			created_at: string;
			updated_at: string;
		}>;
		return rows.map((row) => this.mapMessage(row));
	}

	updateQueuedMessage(
		id: string,
		input: { projectId: string | null; sessionId: string; text: string; images: ImageAttachment[] }
	): StoredMessage {
		const message = this.getMessage(id);
		if (
			!message ||
			message.projectId !== input.projectId ||
			message.sessionId !== input.sessionId
		) {
			throw new Error(`Message ${id} was not found`);
		}
		if (message.status !== 'queued') throw new Error(`Message ${id} is no longer queued`);
		const updatedAt = new Date().toISOString();
		this.database.transaction(() => {
			this.database
				.query('UPDATE messages SET text = ?, updated_at = ? WHERE id = ? AND status = ?')
				.run(input.text, updatedAt, id, 'queued');
			this.database.query('DELETE FROM message_attachments WHERE message_id = ?').run(id);
			const insert = this.database.query(
				'INSERT INTO message_attachments (message_id, position, name, mime_type, data) VALUES (?, ?, ?, ?, ?)'
			);
			for (const [position, image] of input.images.entries()) {
				insert.run(id, position, image.name, image.mimeType, image.data);
			}
			this.appendEvent(input.projectId, input.sessionId, 'message.edited', { messageId: id });
		})();
		return this.getMessage(id)!;
	}

	getBusySessionStarts(projectId: string | null): Record<string, string> {
		const rows = this.database
			.query(
				"SELECT session_id, MIN(created_at) AS started_at FROM messages WHERE project_id IS ? AND status IN ('queued', 'running') GROUP BY session_id"
			)
			.all(projectId) as Array<{ session_id: string; started_at: string }>;
		return Object.fromEntries(rows.map((row) => [row.session_id, row.started_at]));
	}

	getSessionIndicators(
		projectId: string | null
	): Record<string, { attention: boolean; error: boolean }> {
		return Object.fromEntries(
			this.listStoredSessions(projectId).map(({ sessionId }) => {
				const events = this.listEvents(projectId, sessionId);
				const pending = new Map<string, boolean>();
				for (const event of events) {
					if (!['agent.permission', 'agent.clarify'].includes(event.type)) continue;
					const id = String(event.payload.id ?? '');
					if (id) pending.set(id, event.payload.status === 'pending');
				}
				const latest = this.listMessages(projectId, sessionId).at(-1);
				const error = latest?.status === 'failed' || latest?.status === 'unknown';
				return [sessionId, { attention: error || [...pending.values()].some(Boolean), error }];
			})
		);
	}

	private mapMessage(row: {
		id: string;
		project_id: string | null;
		session_id: string;
		text: string;
		status: MessageStatus;
		created_at: string;
		updated_at: string;
	}): StoredMessage {
		return {
			id: row.id,
			projectId: row.project_id,
			sessionId: row.session_id,
			text: row.text,
			images: this.database
				.query(
					'SELECT name, mime_type, data FROM message_attachments WHERE message_id = ? ORDER BY position'
				)
				.all(row.id)
				.map((image) => {
					const value = image as { name: string; mime_type: string; data: string };
					return { name: value.name, mimeType: value.mime_type, data: value.data };
				}),
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}

	updateMessageStatus(id: string, status: MessageStatus): void {
		const message = this.getMessage(id);
		if (!message) throw new Error(`Message ${id} was not found`);
		if (!allowedTransitions[message.status].has(status)) {
			throw new Error(`Cannot transition message ${id} from ${message.status} to ${status}`);
		}
		this.database
			.query('UPDATE messages SET status = ?, updated_at = ? WHERE id = ?')
			.run(status, new Date().toISOString(), id);
	}

	transitionMessage(id: string, status: MessageStatus, payload: Record<string, unknown>): void {
		const message = this.getMessage(id);
		if (!message) throw new Error(`Message ${id} was not found`);
		this.database.transaction(() => {
			this.updateMessageStatus(id, status);
			if (status === 'failed' || status === 'unknown') {
				const pending = new Map<string, SessionEvent>();
				for (const event of this.listEvents(message.projectId, message.sessionId)) {
					if (
						!['agent.permission', 'agent.clarify'].includes(event.type) ||
						event.payload.messageId !== id
					)
						continue;
					pending.set(`${event.type}\0${String(event.payload.id ?? '')}`, event);
				}
				for (const event of pending.values()) {
					if (event.payload.status !== 'pending') continue;
					this.appendEvent(message.projectId, message.sessionId, event.type, {
						id: event.payload.id,
						messageId: id,
						status: 'cancelled'
					});
				}
			}
			this.appendEvent(message.projectId, message.sessionId, `message.${status}`, payload);
		})();
	}

	appendEvent(
		projectId: string | null,
		sessionId: string,
		type: string,
		payload: Record<string, unknown>
	): SessionEvent {
		const redactedPayload = redactPersistedValue(payload) as Record<string, unknown>;
		const createdAt = new Date().toISOString();
		const result = this.database
			.query(
				'INSERT INTO session_events (project_id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.run(projectId, sessionId, type, JSON.stringify(redactedPayload), createdAt);
		return {
			sequence: Number(result.lastInsertRowid),
			projectId,
			sessionId,
			type,
			payload: redactedPayload,
			createdAt
		};
	}

	listEvents(projectId: string | null, sessionId: string, after = 0): SessionEvent[] {
		const rows = this.database
			.query(
				'SELECT sequence, project_id, session_id, type, payload, created_at FROM session_events WHERE project_id IS ? AND session_id = ? AND sequence > ? ORDER BY sequence'
			)
			.all(projectId, sessionId, after) as Array<{
			sequence: number;
			project_id: string | null;
			session_id: string;
			type: string;
			payload: string;
			created_at: string;
		}>;
		return rows.map((row) => ({
			sequence: row.sequence,
			projectId: row.project_id,
			sessionId: row.session_id,
			type: row.type,
			payload: JSON.parse(row.payload) as Record<string, unknown>,
			createdAt: row.created_at
		}));
	}

	getSessionSnapshot(
		projectId: string | null,
		sessionId: string
	): {
		messages: StoredMessage[];
		events: SessionEvent[];
		cursor: number;
		activeTurn: {
			messageId: string;
			status: 'queued' | 'running' | 'unknown';
			thought: string;
			output: string;
			images: ImageAttachment[];
			error: string | null;
		} | null;
	} {
		const messages = this.listMessages(projectId, sessionId);
		const events = this.listEvents(projectId, sessionId);
		const activeMessageRecord =
			messages.find(({ status }) => status === 'running' || status === 'unknown') ??
			messages.find(({ status }) => status === 'queued');
		const activeTurn = activeMessageRecord
			? {
					messageId: activeMessageRecord.id,
					status: activeMessageRecord.status as 'queued' | 'running' | 'unknown',
					thought: events
						.filter(
							(event) =>
								event.type === 'agent.thought' && event.payload.messageId === activeMessageRecord.id
						)
						.map((event) => String(event.payload.text ?? ''))
						.join(''),
					output: events
						.filter(
							(event) =>
								event.type === 'agent.chunk' && event.payload.messageId === activeMessageRecord.id
						)
						.map((event) => String(event.payload.text ?? ''))
						.join(''),
					images: events
						.filter(
							(event) =>
								event.type === 'agent.image' && event.payload.messageId === activeMessageRecord.id
						)
						.map((event) => event.payload.image as ImageAttachment),
					error:
						(events.findLast(
							(event) =>
								event.type === 'message.unknown' &&
								event.payload.messageId === activeMessageRecord.id
						)?.payload.error as string | undefined) ?? null
				}
			: null;
		return {
			messages,
			events,
			cursor: events.at(-1)?.sequence ?? 0,
			activeTurn
		};
	}

	close() {
		this.database.close();
	}
}
