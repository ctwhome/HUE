import { createRequire } from 'node:module';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database as BunDatabase } from 'bun:sqlite';
import { validateIcon } from '$lib/icon';
import type { ImageAttachment, InputAttachment, ReviewContext } from '$lib/message-content';
import { validateProjectColor } from '$lib/project-color';
import { DEFAULT_WORK_MODE, parseWorkMode, type WorkMode } from '$lib/work-mode';
import { redactPersistedValue } from './redaction';

const runtimeRequire = createRequire(import.meta.url);

export type MessageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';

export type Project = {
	id: string;
	name: string;
	rootPath: string;
	icon: string | null;
	createdAt: string;
};

export type ProjectExcalidraw = {
	projectId: string;
	address: string;
	scene: string;
	updatedAt: string;
};

export type Workflow = {
	id: string;
	projectId: string;
	name: string;
	prompt: string;
	profile: string;
	workMode: WorkMode;
	archived: boolean;
	createdAt: string;
	updatedAt: string;
};

export type StoredMessage = {
	id: string;
	projectId: string | null;
	sessionId: string;
	text: string;
	images: ImageAttachment[];
	attachments: InputAttachment[];
	reviewContexts: ReviewContext[];
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

export type NotificationKind = 'completed' | 'permission' | 'clarify' | 'failed' | 'unknown';

export type StoredNotification = {
	id: string;
	sourceEventId: string;
	projectId: string | null;
	sessionId: string;
	kind: NotificationKind;
	priority: 'normal' | 'high';
	title: string;
	body: string;
	path: string;
	createdAt: string;
	readAt: string | null;
	dismissedAt: string | null;
	actedAt: string | null;
};

export type StoredSession = {
	sessionId: string;
	cwd: string;
	icon: string | null;
	title: string | null;
	workMode: WorkMode;
	pinned: boolean;
	archived: boolean;
	folder: string | null;
	tags: string[];
	updatedAt: string;
};

export type SessionFinderStatus = 'running' | 'waiting' | 'unknown' | 'failed' | 'archived';

export type SessionFinderResult = StoredSession & {
	projectId: string | null;
	projectName: string | null;
	status: SessionFinderStatus | null;
};

type SessionRow = {
	session_id: string;
	cwd: string;
	icon: string | null;
	title: string | null;
	work_mode: WorkMode;
	pinned: number;
	archived: number;
	folder: string | null;
	tags: string;
	updated_at: string;
};

type NotificationRow = {
	id: string;
	source_event_id: string;
	project_id: string | null;
	session_id: string;
	kind: NotificationKind;
	priority: 'normal' | 'high';
	title: string;
	body: string;
	path: string;
	created_at: string;
	read_at: string | null;
	dismissed_at: string | null;
	acted_at: string | null;
};

function mapNotification(row: NotificationRow): StoredNotification {
	return {
		id: row.id,
		sourceEventId: row.source_event_id,
		projectId: row.project_id,
		sessionId: row.session_id,
		kind: row.kind,
		priority: row.priority,
		title: row.title,
		body: row.body,
		path: row.path,
		createdAt: row.created_at,
		readAt: row.read_at,
		dismissedAt: row.dismissed_at,
		actedAt: row.acted_at
	};
}

function notificationPresentation(
	type: string
): Pick<StoredNotification, 'kind' | 'priority' | 'title' | 'body'> | null {
	switch (type) {
		case 'message.completed':
			return {
				kind: 'completed',
				priority: 'normal',
				title: 'Task completed',
				body: 'Open HUE to review the result.'
			};
		case 'agent.permission':
			return {
				kind: 'permission',
				priority: 'high',
				title: 'HUE needs permission',
				body: 'Open HUE to review the request.'
			};
		case 'agent.clarify':
			return {
				kind: 'clarify',
				priority: 'high',
				title: 'HUE needs your input',
				body: 'Open HUE to answer safely.'
			};
		case 'message.failed':
			return {
				kind: 'failed',
				priority: 'high',
				title: 'Task failed',
				body: 'Open HUE to inspect the failure.'
			};
		case 'message.unknown':
			return {
				kind: 'unknown',
				priority: 'high',
				title: 'Task outcome unknown',
				body: 'Open HUE to inspect delivery state.'
			};
		default:
			return null;
	}
}

function cleanOptional(value: unknown, max: number, label: string): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
		throw new Error(`Session ${label} must be 1-${max} characters`);
	}
	return value.trim();
}

function validateTags(tags: unknown): string[] {
	if (!Array.isArray(tags) || tags.length > 10) throw new Error('A Session supports up to 10 tags');
	const normalized = tags.map((tag) => cleanOptional(tag, 40, 'tag')!);
	return [...new Set(normalized)];
}

type SessionCopyMetadata = Pick<
	StoredSession,
	'title' | 'pinned' | 'archived' | 'folder' | 'tags'
> & { title: string };

function normalizeStoredAttachments(
	images: ImageAttachment[],
	attachments: InputAttachment[]
): InputAttachment[] {
	return [
		...images.map((image) => ({ ...image, size: Buffer.from(image.data, 'base64').byteLength })),
		...attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size, data: '' }))
	];
}

function remapMessageIds(value: unknown, ids: ReadonlyMap<string, string>): unknown {
	if (Array.isArray(value)) return value.map((item) => remapMessageIds(item, ids));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			key === 'messageId' && typeof item === 'string'
				? (ids.get(item) ?? item)
				: remapMessageIds(item, ids)
		])
	);
}

export class MessageConflictError extends Error {
	constructor(messageId: string) {
		super(`Message id ${messageId} was already used for a different envelope`);
		this.name = 'MessageConflictError';
	}
}

const allowedTransitions: Record<MessageStatus, ReadonlySet<MessageStatus>> = {
	queued: new Set(['running', 'failed']),
	running: new Set(['completed', 'failed', 'unknown', 'cancelled']),
	completed: new Set(),
	failed: new Set(),
	unknown: new Set(),
	cancelled: new Set()
};

export class HUEStore {
	readonly database: BunDatabase;
	readonly filename: string;

	constructor(filename: string) {
		this.filename = filename;
		if (filename !== ':memory:') secureDatabasePath(filename);
		const { Database } = runtimeRequire('bun:sqlite') as typeof import('bun:sqlite');
		this.database = new Database(filename, { create: true, strict: true });
		if (filename !== ':memory:' && (lstatSync(filename).mode & 0o777) !== 0o600)
			chmodSync(filename, 0o600);
		this.database.exec('PRAGMA foreign_keys = ON');
		this.database.exec('PRAGMA secure_delete = ON');
		this.migrate();
	}

	private migrate() {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				root_path TEXT NOT NULL UNIQUE,
				icon TEXT,
				group_name TEXT,
				legacy INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS workflows (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				prompt TEXT NOT NULL,
				profile TEXT NOT NULL DEFAULT 'default',
				work_mode TEXT NOT NULL DEFAULT 'autonomous',
				archived INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS workflows_project_id_idx
				ON workflows(project_id, created_at, id);

			CREATE TABLE IF NOT EXISTS project_excalidraw (
				project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
				address TEXT NOT NULL DEFAULT '',
				scene TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS project_sessions (
				session_id TEXT PRIMARY KEY,
				project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
				cwd TEXT NOT NULL,
				icon TEXT,
				work_mode TEXT NOT NULL DEFAULT 'autonomous' CHECK (work_mode IN ('autonomous', 'live')),
				updated_at TEXT NOT NULL,
				UNIQUE (project_id, session_id)
			);

			CREATE TABLE IF NOT EXISTS dismissed_sessions (
				project_scope TEXT NOT NULL,
				session_id TEXT NOT NULL,
				dismissed_at TEXT NOT NULL,
				PRIMARY KEY (project_scope, session_id)
			);

			CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				text TEXT NOT NULL,
				review_contexts TEXT NOT NULL DEFAULT '[]',
				status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unknown', 'cancelled')),
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

			CREATE TABLE IF NOT EXISTS notifications (
				id TEXT PRIMARY KEY,
				source_event_id TEXT NOT NULL UNIQUE,
				project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
				session_id TEXT NOT NULL,
				kind TEXT NOT NULL CHECK (kind IN ('completed', 'permission', 'clarify', 'failed', 'unknown')),
				priority TEXT NOT NULL CHECK (priority IN ('normal', 'high')),
				title TEXT NOT NULL,
				body TEXT NOT NULL,
				path TEXT NOT NULL,
				created_at TEXT NOT NULL,
				read_at TEXT,
				dismissed_at TEXT,
				acted_at TEXT
			);

			CREATE INDEX IF NOT EXISTS notifications_created_idx
				ON notifications(created_at DESC, source_event_id DESC);
			CREATE INDEX IF NOT EXISTS notifications_unread_idx
				ON notifications(read_at, dismissed_at, source_event_id DESC);

			CREATE TABLE IF NOT EXISTS notification_endpoints (
				id TEXT PRIMARY KEY,
				device_id TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				endpoint TEXT NOT NULL,
				p256dh TEXT NOT NULL,
				auth TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				revoked_at TEXT,
				notification_baseline INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
				id TEXT PRIMARY KEY,
				notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
				endpoint_id TEXT NOT NULL REFERENCES notification_endpoints(id) ON DELETE CASCADE,
				status TEXT NOT NULL CHECK (status IN ('queued', 'retry', 'accepted', 'expired', 'suppressed')),
				attempt_count INTEGER NOT NULL DEFAULT 0,
				error_category TEXT,
				next_attempt_at TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				accepted_at TEXT,
				UNIQUE (notification_id, endpoint_id)
			);

			CREATE INDEX IF NOT EXISTS notification_attempts_due_idx
				ON notification_delivery_attempts(status, next_attempt_at);

			CREATE TABLE IF NOT EXISTS notification_presence (
				endpoint_id TEXT PRIMARY KEY REFERENCES notification_endpoints(id) ON DELETE CASCADE,
				project_id TEXT,
				session_id TEXT,
				visible INTEGER NOT NULL,
				expires_at TEXT NOT NULL
			);
		`);
		const projectColumns = this.database.query('PRAGMA table_info(projects)').all() as Array<{
			name: string;
		}>;
		if (!projectColumns.some((column) => column.name === 'icon')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN icon TEXT');
		}
		if (!projectColumns.some((column) => column.name === 'legacy')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN legacy INTEGER NOT NULL DEFAULT 1');
		}
		if (!projectColumns.some((column) => column.name === 'color')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN color TEXT');
		}
		if (!projectColumns.some((column) => column.name === 'group_name')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN group_name TEXT');
		}
		const workflowColumns = this.database.query('PRAGMA table_info(workflows)').all() as Array<{
			name: string;
		}>;
		for (const [name, definition] of [
			['work_mode', "TEXT NOT NULL DEFAULT 'autonomous'"],
			['archived', 'INTEGER NOT NULL DEFAULT 0'],
			['updated_at', "TEXT NOT NULL DEFAULT ''"]
		] as const) {
			if (!workflowColumns.some((column) => column.name === name)) {
				this.database.exec(`ALTER TABLE workflows ADD COLUMN ${name} ${definition}`);
			}
		}
		this.database.exec("UPDATE workflows SET updated_at = created_at WHERE updated_at = ''");
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
		for (const [name, definition] of [
			['title', 'TEXT'],
			['title_custom', 'INTEGER NOT NULL DEFAULT 0'],
			['work_mode', "TEXT NOT NULL DEFAULT 'autonomous'"],
			['pinned', 'INTEGER NOT NULL DEFAULT 0'],
			['archived', 'INTEGER NOT NULL DEFAULT 0'],
			['folder', 'TEXT'],
			['tags', "TEXT NOT NULL DEFAULT '[]'"]
		] as const) {
			if (!sessionColumns.some((column) => column.name === name)) {
				this.database.exec(`ALTER TABLE project_sessions ADD COLUMN ${name} ${definition}`);
			}
		}
		this.database.exec(`
			CREATE TRIGGER IF NOT EXISTS project_sessions_work_mode_insert_check
			BEFORE INSERT ON project_sessions
			FOR EACH ROW
			WHEN NEW.work_mode NOT IN ('autonomous', 'live')
			BEGIN
				SELECT RAISE(FAIL, 'invalid work_mode');
			END;

			CREATE TRIGGER IF NOT EXISTS project_sessions_work_mode_update_check
			BEFORE UPDATE OF work_mode ON project_sessions
			FOR EACH ROW
			WHEN NEW.work_mode NOT IN ('autonomous', 'live')
			BEGIN
				SELECT RAISE(FAIL, 'invalid work_mode');
			END;
		`);
		const messageColumns = this.database.query('PRAGMA table_info(messages)').all() as Array<{
			name: string;
		}>;
		if (!messageColumns.some((column) => column.name === 'project_id')) {
			this.database.exec('ALTER TABLE messages ADD COLUMN project_id TEXT REFERENCES projects(id)');
		}
		if (!messageColumns.some((column) => column.name === 'review_contexts')) {
			this.database.exec(
				"ALTER TABLE messages ADD COLUMN review_contexts TEXT NOT NULL DEFAULT '[]'"
			);
		}
		const attachmentColumns = this.database
			.query('PRAGMA table_info(message_attachments)')
			.all() as Array<{ name: string }>;
		if (!attachmentColumns.some((column) => column.name === 'size')) {
			this.database.exec('ALTER TABLE message_attachments ADD COLUMN size INTEGER');
		}
		const messagesSchema = this.database
			.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
			.get() as { sql: string } | null;
		if (messagesSchema?.sql.includes('CHECK') && !messagesSchema.sql.includes("'cancelled'")) {
			this.database.exec('PRAGMA foreign_keys = OFF');
			try {
				this.database.transaction(() => {
					this.database.exec(`
						ALTER TABLE message_attachments RENAME TO message_attachments_before_cancelled;
						ALTER TABLE messages RENAME TO messages_before_cancelled;
						CREATE TABLE messages (
							id TEXT PRIMARY KEY,
							project_id TEXT REFERENCES projects(id),
							session_id TEXT NOT NULL,
							text TEXT NOT NULL,
							review_contexts TEXT NOT NULL DEFAULT '[]',
							status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unknown', 'cancelled')),
							created_at TEXT NOT NULL,
							updated_at TEXT NOT NULL
						);
						INSERT INTO messages SELECT id, project_id, session_id, text, review_contexts, status, created_at, updated_at
							FROM messages_before_cancelled;
						CREATE TABLE message_attachments (
							message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
							position INTEGER NOT NULL,
							name TEXT NOT NULL,
							mime_type TEXT NOT NULL,
							data TEXT NOT NULL,
							size INTEGER,
							PRIMARY KEY (message_id, position)
						);
						INSERT INTO message_attachments SELECT message_id, position, name, mime_type, data, size
							FROM message_attachments_before_cancelled;
						DROP TABLE message_attachments_before_cancelled;
						DROP TABLE messages_before_cancelled;
					`);
				})();
			} finally {
				this.database.exec('PRAGMA foreign_keys = ON');
			}
		}
		const eventColumns = this.database.query('PRAGMA table_info(session_events)').all() as Array<{
			name: string;
		}>;
		if (!eventColumns.some((column) => column.name === 'project_id')) {
			this.database.exec(
				'ALTER TABLE session_events ADD COLUMN project_id TEXT REFERENCES projects(id)'
			);
		}
		const endpointColumns = this.database
			.query('PRAGMA table_info(notification_endpoints)')
			.all() as Array<{ name: string }>;
		let initializeEndpointBaselines = false;
		if (!endpointColumns.some((column) => column.name === 'notification_baseline')) {
			this.database.exec(
				'ALTER TABLE notification_endpoints ADD COLUMN notification_baseline INTEGER NOT NULL DEFAULT 0'
			);
			initializeEndpointBaselines = true;
		}
		this.database.exec(`
			CREATE INDEX IF NOT EXISTS messages_session_id_idx
				ON messages(session_id, created_at, id);
			CREATE INDEX IF NOT EXISTS messages_project_session_idx
				ON messages(project_id, session_id, created_at, id);
				CREATE INDEX IF NOT EXISTS session_events_project_cursor_idx
					ON session_events(project_id, session_id, sequence);
				CREATE INDEX IF NOT EXISTS session_events_project_type_cursor_idx
					ON session_events(project_id, type, session_id, sequence DESC);
			CREATE INDEX IF NOT EXISTS project_sessions_scope_list_idx
				ON project_sessions(project_id, archived, pinned DESC, updated_at DESC, session_id);
		`);
		this.projectPendingNotifications();
		this.database.exec(`
			UPDATE notifications SET path = path || '&event=' || source_event_id
			 WHERE path NOT LIKE '%?event=%' AND path NOT LIKE '%&event=%'
		`);
		if (initializeEndpointBaselines) {
			this.database.exec(`
				UPDATE notification_endpoints SET notification_baseline =
					COALESCE((SELECT MAX(CAST(source_event_id AS INTEGER)) FROM notifications), 0)
			`);
		}
	}

	projectPendingNotifications(): number {
		const rows = this.database
			.query(
				`SELECT e.sequence, e.project_id, e.session_id, e.type, e.created_at
				 FROM session_events e
				 LEFT JOIN notifications n ON n.source_event_id = CAST(e.sequence AS TEXT)
				 WHERE n.id IS NULL AND (
					e.type IN ('message.completed', 'message.failed', 'message.unknown') OR
					(e.type IN ('agent.permission', 'agent.clarify') AND json_extract(e.payload, '$.status') = 'pending')
				 )
				 ORDER BY e.sequence`
			)
			.all() as Array<{
			sequence: number;
			project_id: string | null;
			session_id: string;
			type: string;
			created_at: string;
		}>;
		this.database.transaction(() => {
			for (const row of rows) this.insertNotification(row);
		})();
		return rows.length;
	}

	private insertNotification(event: {
		sequence: number;
		project_id: string | null;
		session_id: string;
		type: string;
		created_at: string;
	}): void {
		const presentation = notificationPresentation(event.type);
		if (!presentation) return;
		const path = event.project_id
			? `/?project=${encodeURIComponent(event.project_id)}&session=${encodeURIComponent(event.session_id)}&event=${event.sequence}`
			: `/?project=none&session=${encodeURIComponent(event.session_id)}&event=${event.sequence}`;
		this.database
			.query(
				`INSERT OR IGNORE INTO notifications
				 (id, source_event_id, project_id, session_id, kind, priority, title, body, path, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				`notification:${event.sequence}`,
				String(event.sequence),
				event.project_id,
				event.session_id,
				presentation.kind,
				presentation.priority,
				presentation.title,
				presentation.body,
				path,
				event.created_at
			);
	}

	listNotifications(options: { unreadOnly?: boolean; limit?: number; cursor?: string | null }): {
		items: StoredNotification[];
		nextCursor: string | null;
	} {
		const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50) || 50, 100));
		const cursor = options.cursor ? Number(options.cursor) : Number.MAX_SAFE_INTEGER;
		if (!Number.isSafeInteger(cursor) || cursor < 1) throw new Error('Invalid notification cursor');
		const rows = this.database
			.query(
				`SELECT id, source_event_id, project_id, session_id, kind, priority, title, body, path,
				 created_at, read_at, dismissed_at, acted_at
				 FROM notifications
				 WHERE CAST(source_event_id AS INTEGER) < ?
				   AND (? = 0 OR (read_at IS NULL AND dismissed_at IS NULL))
				 ORDER BY CAST(source_event_id AS INTEGER) DESC LIMIT ?`
			)
			.all(cursor, options.unreadOnly ? 1 : 0, limit + 1) as NotificationRow[];
		const items = rows.slice(0, limit).map(mapNotification);
		return {
			items,
			nextCursor: rows.length > limit ? rows[limit - 1]!.source_event_id : null
		};
	}

	notificationCounts(): { unread: number; all: number } {
		const row = this.database
			.query(
				`SELECT COUNT(*) AS all_count,
				 SUM(CASE WHEN read_at IS NULL AND dismissed_at IS NULL THEN 1 ELSE 0 END) AS unread_count
				 FROM notifications`
			)
			.get() as { all_count: number; unread_count: number | null };
		return { all: row.all_count, unread: row.unread_count ?? 0 };
	}

	markAllNotificationsRead(): number {
		return Number(
			this.database
				.query(
					`UPDATE notifications SET read_at = ?
					 WHERE read_at IS NULL AND dismissed_at IS NULL`
				)
				.run(new Date().toISOString()).changes
		);
	}

	getNotification(id: string): StoredNotification | null {
		const row = this.database
			.query(
				`SELECT id, source_event_id, project_id, session_id, kind, priority, title, body, path,
				 created_at, read_at, dismissed_at, acted_at FROM notifications WHERE id = ?`
			)
			.get(id) as NotificationRow | null;
		return row ? mapNotification(row) : null;
	}

	updateNotification(id: string, state: 'read' | 'dismissed' | 'acted'): StoredNotification {
		const now = new Date().toISOString();
		const column =
			state === 'read' ? 'read_at' : state === 'dismissed' ? 'dismissed_at' : 'acted_at';
		const read = state === 'read' ? '' : ', read_at = COALESCE(read_at, ?)';
		const result = this.database
			.query(`UPDATE notifications SET ${column} = COALESCE(${column}, ?)${read} WHERE id = ?`)
			.run(...(read ? [now, now, id] : [now, id]));
		if (!result.changes) throw new Error('Notification not found');
		return this.getNotification(id)!;
	}

	upsertSession(
		projectId: string | null,
		session: {
			sessionId: string;
			cwd: string;
			title?: string | null;
			updatedAt?: string | null;
			workMode?: WorkMode | null;
		}
	): void {
		if (this.isSessionDismissed(projectId, session.sessionId)) return;
		const existing = this.database
			.query('SELECT project_id FROM project_sessions WHERE session_id = ?')
			.get(session.sessionId) as { project_id: string | null } | null;
		if (existing && existing.project_id !== projectId) {
			throw new Error(
				`Session ${session.sessionId} already belongs to ${existing.project_id ? `Project ${existing.project_id}` : 'No project'}`
			);
		}
		const now = session.updatedAt ?? new Date().toISOString();
		const workMode = parseWorkMode(session.workMode) ?? DEFAULT_WORK_MODE;
		this.database.transaction(() => {
			this.database
				.query(
					`INSERT INTO project_sessions (session_id, project_id, cwd, title, work_mode, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?)
					 ON CONFLICT(session_id) DO UPDATE SET
					 project_id = excluded.project_id,
					 cwd = excluded.cwd,
					 title = CASE WHEN project_sessions.title_custom = 1 THEN project_sessions.title ELSE COALESCE(excluded.title, project_sessions.title) END,
					 work_mode = project_sessions.work_mode,
					 updated_at = excluded.updated_at`
				)
				.run(session.sessionId, projectId, session.cwd, session.title ?? null, workMode, now);
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

	applyRuntimeSessionTitle(sessionId: string, input: unknown): SessionEvent | null {
		const title = cleanOptional(input, 200, 'title');
		let event: SessionEvent | null = null;
		this.database.transaction(() => {
			const session = this.database
				.query('SELECT project_id, title, title_custom FROM project_sessions WHERE session_id = ?')
				.get(sessionId) as {
				project_id: string | null;
				title: string | null;
				title_custom: number;
			} | null;
			if (!session || session.title_custom || session.title === title) return;
			this.database
				.query('UPDATE project_sessions SET title = ? WHERE session_id = ?')
				.run(title, sessionId);
			event = this.appendEvent(session.project_id, sessionId, 'session.info_updated', { title });
		})();
		return event;
	}

	hasSession(projectId: string | null, sessionId: string): boolean {
		return !!this.database
			.query('SELECT 1 FROM project_sessions WHERE project_id IS ? AND session_id = ?')
			.get(projectId, sessionId);
	}

	getSession(projectId: string | null, sessionId: string): StoredSession | null {
		const row = this.database
			.query(
				'SELECT session_id, cwd, icon, title, work_mode, pinned, archived, folder, tags, updated_at FROM project_sessions WHERE project_id IS ? AND session_id = ?'
			)
			.get(projectId, sessionId) as SessionRow | null;
		return row ? this.mapSession(row) : null;
	}

	listStoredSessions(
		projectId: string | null,
		includeArchived = true,
		limit = 200
	): StoredSession[] {
		const rows = this.database
			.query(
				`SELECT session_id, cwd, icon, title, pinned, archived, folder, tags, updated_at
				 , work_mode
				 FROM project_sessions WHERE project_id IS ? AND (? OR archived = 0)
				 ORDER BY pinned DESC, updated_at DESC, session_id LIMIT ?`
			)
			.all(projectId, includeArchived ? 1 : 0, Math.max(1, Math.min(limit, 500))) as SessionRow[];
		return rows.map((row) => this.mapSession(row));
	}

	listSessionRoots(projectId: string | null): string[] {
		return (
			this.database
				.query('SELECT DISTINCT cwd FROM project_sessions WHERE project_id IS ? ORDER BY cwd')
				.all(projectId) as Array<{ cwd: string }>
		).map(({ cwd }) => cwd);
	}

	listSessionPage(
		projectId: string | null,
		options: { includeArchived: boolean; query: string; limit: number; offset: number }
	): { sessions: StoredSession[]; hasMore: boolean } {
		const requestedLimit = Math.trunc(options.limit);
		const requestedOffset = Math.trunc(options.offset);
		const limit =
			Number.isSafeInteger(requestedLimit) && requestedLimit > 0
				? Math.min(requestedLimit, 100)
				: 100;
		const offset =
			Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
		const needle = options.query.trim().toLowerCase();
		const columns =
			'ps.session_id, ps.cwd, ps.icon, ps.title, ps.work_mode, ps.pinned, ps.archived, ps.folder, ps.tags, ps.updated_at';
		const rows = needle
			? (this.database
					.query(
						`WITH matched(session_id) AS (
							SELECT session_id FROM project_sessions
							 WHERE project_id IS ? AND instr(lower(COALESCE(title, '')), ?) > 0
							UNION
							SELECT session_id FROM messages
							 WHERE project_id IS ? AND instr(lower(text), ?) > 0
							UNION
							SELECT session_id FROM session_events
							 WHERE project_id IS ? AND type = 'agent.chunk' AND instr(lower(payload), ?) > 0
						)
						SELECT ${columns} FROM project_sessions ps
						JOIN matched ON matched.session_id = ps.session_id
						WHERE ps.project_id IS ? AND (? OR ps.archived = 0)
						ORDER BY ps.pinned DESC, ps.updated_at DESC, ps.session_id
						LIMIT ? OFFSET ?`
					)
					.all(
						projectId,
						needle,
						projectId,
						needle,
						projectId,
						needle,
						projectId,
						options.includeArchived ? 1 : 0,
						limit + 1,
						offset
					) as SessionRow[])
			: (this.database
					.query(
						`SELECT ${columns} FROM project_sessions ps
						 WHERE ps.project_id IS ? AND (? OR ps.archived = 0)
						 ORDER BY ps.pinned DESC, ps.updated_at DESC, ps.session_id
						 LIMIT ? OFFSET ?`
					)
					.all(projectId, options.includeArchived ? 1 : 0, limit + 1, offset) as SessionRow[]);
		return {
			sessions: rows.slice(0, limit).map((row) => this.mapSession(row)),
			hasMore: rows.length > limit
		};
	}

	updateSessionMetadata(
		projectId: string | null,
		sessionId: string,
		input: Partial<Pick<StoredSession, 'title' | 'pinned' | 'archived' | 'folder' | 'tags'>>
	): StoredSession {
		return this.updateSession(projectId, sessionId, input);
	}

	updateSession(
		projectId: string | null,
		sessionId: string,
		input: Partial<Record<'title' | 'pinned' | 'archived' | 'folder' | 'tags' | 'icon', unknown>>
	): StoredSession {
		const current = this.getSession(projectId, sessionId);
		if (!current) throw new Error('Session not found');
		const title =
			input.title === undefined ? current.title : cleanOptional(input.title, 200, 'title');
		const folder =
			input.folder === undefined ? current.folder : cleanOptional(input.folder, 100, 'folder');
		const tags = input.tags === undefined ? current.tags : validateTags(input.tags);
		if (input.pinned !== undefined && typeof input.pinned !== 'boolean')
			throw new Error('Session pinned must be boolean');
		if (input.archived !== undefined && typeof input.archived !== 'boolean')
			throw new Error('Session archived must be boolean');
		const icon = input.icon === undefined ? current.icon : validateIcon(input.icon);
		this.database.transaction(() => {
			this.database
				.query(
					`UPDATE project_sessions SET title = ?, title_custom = CASE WHEN ? THEN 1 ELSE title_custom END, pinned = ?, archived = ?, folder = ?, tags = ?, icon = ?, updated_at = ?
					 WHERE project_id IS ? AND session_id = ?`
				)
				.run(
					title,
					input.title === undefined ? 0 : 1,
					(input.pinned ?? current.pinned) ? 1 : 0,
					(input.archived ?? current.archived) ? 1 : 0,
					folder,
					JSON.stringify(tags),
					icon,
					new Date().toISOString(),
					projectId,
					sessionId
				);
		})();
		return this.getSession(projectId, sessionId)!;
	}

	prepareSessionCopy(
		projectId: string | null,
		sourceSessionId: string,
		title?: unknown
	): SessionCopyMetadata {
		const source = this.getSession(projectId, sourceSessionId);
		if (!source) throw new Error('Session not found');
		const preparedTitle = cleanOptional(
			title === undefined ? `${source.title ?? 'Untitled Session'} copy` : title,
			200,
			'title'
		)!;
		const folder = cleanOptional(source.folder, 100, 'folder');
		const tags = validateTags(source.tags);
		if (typeof source.pinned !== 'boolean' || typeof source.archived !== 'boolean') {
			throw new Error('Invalid Session metadata');
		}
		return { title: preparedTitle, pinned: false, archived: false, folder, tags };
	}

	copySessionMetadata(
		projectId: string | null,
		sourceSessionId: string,
		targetSessionId: string,
		input: string | SessionCopyMetadata
	): StoredSession {
		const source = this.getSession(projectId, sourceSessionId);
		if (!source || !this.getSession(projectId, targetSessionId))
			throw new Error('Session not found');
		const metadata =
			typeof input === 'string'
				? this.prepareSessionCopy(projectId, sourceSessionId, input)
				: input;
		const target = this.updateSessionMetadata(projectId, targetSessionId, {
			...metadata
		});
		this.database.transaction(() => {
			const messages = this.database
				.query(
					'SELECT id, text, review_contexts, status, created_at, updated_at FROM messages WHERE project_id IS ? AND session_id = ? ORDER BY created_at, id'
				)
				.all(projectId, sourceSessionId) as Array<{
				id: string;
				text: string;
				review_contexts: string;
				status: MessageStatus;
				created_at: string;
				updated_at: string;
			}>;
			const ids = new Map(messages.map(({ id }) => [id, crypto.randomUUID()]));
			const insertMessage = this.database.query(
				'INSERT INTO messages (id, project_id, session_id, text, review_contexts, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			);
			const insertAttachment = this.database.query(
				'INSERT INTO message_attachments (message_id, position, name, mime_type, data, size) VALUES (?, ?, ?, ?, ?, ?)'
			);
			for (const message of messages) {
				const targetMessageId = ids.get(message.id)!;
				insertMessage.run(
					targetMessageId,
					projectId,
					targetSessionId,
					message.text,
					message.review_contexts,
					message.status,
					message.created_at,
					message.updated_at
				);
				const attachments = this.database
					.query(
						'SELECT position, name, mime_type, size FROM message_attachments WHERE message_id = ? ORDER BY position'
					)
					.all(message.id) as Array<{
					position: number;
					name: string;
					mime_type: string;
					size: number;
				}>;
				for (const attachment of attachments) {
					insertAttachment.run(
						targetMessageId,
						attachment.position,
						attachment.name,
						attachment.mime_type,
						'',
						attachment.size
					);
				}
			}
			const events = this.database
				.query(
					"SELECT type, payload, created_at FROM session_events WHERE project_id IS ? AND session_id = ? AND type NOT IN ('agent.image', 'session.work_mode_changed') ORDER BY sequence"
				)
				.all(projectId, sourceSessionId) as Array<{
				type: string;
				payload: string;
				created_at: string;
			}>;
			const insertEvent = this.database.query(
				'INSERT INTO session_events (project_id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
			);
			for (const event of events) {
				insertEvent.run(
					projectId,
					targetSessionId,
					event.type,
					JSON.stringify(remapMessageIds(JSON.parse(event.payload), ids)),
					event.created_at
				);
			}
		})();
		return target;
	}

	searchSessions(projectId: string | null, query: string, limit = 50): StoredSession[] {
		return this.listSessionPage(projectId, {
			includeArchived: true,
			query,
			limit,
			offset: 0
		}).sessions;
	}

	findSessions(
		query: string,
		status: SessionFinderStatus | '' = '',
		limit = 50
	): SessionFinderResult[] {
		const needle = query.trim().toLowerCase();
		if (needle.length > 200) throw new Error('Search query is too long');
		const rows = this.database
			.query(
				`WITH input(needle, status_filter) AS (VALUES (?, ?)),
				message_order AS (
					SELECT m.session_id, m.id, m.status, m.created_at, MAX(e.sequence) AS lifecycle_sequence
					FROM messages m
					LEFT JOIN session_events e
						ON e.project_id IS m.project_id AND e.session_id = m.session_id
						AND json_extract(e.payload, '$.messageId') = m.id
						AND e.type IN ('message.accepted', 'message.running', 'message.completed', 'message.failed', 'message.unknown', 'message.cancelled')
					GROUP BY m.id
				), latest_message AS (
					SELECT session_id, id, status,
						ROW_NUMBER() OVER (
							PARTITION BY session_id ORDER BY lifecycle_sequence DESC, created_at DESC, id DESC
						) AS rank
					FROM message_order
				), latest_interaction AS (
					SELECT session_id, type, json_extract(payload, '$.messageId') AS message_id,
						json_extract(payload, '$.status') AS status,
						ROW_NUMBER() OVER (
							PARTITION BY session_id, type, json_extract(payload, '$.id') ORDER BY sequence DESC
						) AS rank
					FROM session_events WHERE type IN ('agent.permission', 'agent.clarify')
				), finder AS (
					SELECT ps.session_id, ps.project_id, p.name AS project_name, ps.cwd, ps.icon, ps.title,
						ps.work_mode, ps.pinned, ps.archived, ps.folder, ps.tags, ps.updated_at,
						CASE
							WHEN ps.archived = 1 THEN 'archived'
							WHEN MAX(CASE WHEN lm.status IN ('queued', 'running') AND li.status = 'pending' THEN 1 ELSE 0 END) = 1 THEN 'waiting'
							WHEN MAX(CASE WHEN lm.status = 'unknown' THEN 1 ELSE 0 END) = 1 THEN 'unknown'
							WHEN MAX(CASE WHEN lm.status = 'failed' THEN 1 ELSE 0 END) = 1 THEN 'failed'
							WHEN MAX(CASE WHEN lm.status IN ('queued', 'running') THEN 1 ELSE 0 END) = 1 THEN 'running'
							ELSE NULL
						END AS finder_status
					FROM project_sessions ps
					LEFT JOIN projects p ON p.id = ps.project_id
					LEFT JOIN latest_message lm ON lm.session_id = ps.session_id AND lm.rank = 1
					LEFT JOIN latest_interaction li
						ON li.session_id = ps.session_id AND li.message_id = lm.id AND li.rank = 1
					CROSS JOIN input i
					WHERE i.needle = ''
						OR instr(lower(COALESCE(ps.title, '')), i.needle) > 0
						OR instr(lower(COALESCE(ps.folder, '')), i.needle) > 0
						OR instr(lower(ps.tags), i.needle) > 0
						OR instr(lower(COALESCE(p.name, '')), i.needle) > 0
						OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = ps.session_id AND instr(lower(m.text), i.needle) > 0)
						OR EXISTS (SELECT 1 FROM session_events e WHERE e.session_id = ps.session_id AND e.type = 'agent.chunk' AND instr(lower(COALESCE(json_extract(e.payload, '$.text'), '')), i.needle) > 0)
					GROUP BY ps.session_id
				)
				SELECT finder.* FROM finder CROSS JOIN input i
				WHERE i.status_filter = '' OR finder.finder_status = i.status_filter
				ORDER BY finder.updated_at DESC, finder.session_id
				LIMIT ?`
			)
			.all(needle, status, Math.max(1, Math.min(Math.trunc(limit) || 50, 100))) as Array<
			SessionRow & {
				project_id: string | null;
				project_name: string | null;
				finder_status: SessionFinderStatus | null;
			}
		>;
		return rows.map((row) => ({
			...this.mapSession(row),
			projectId: row.project_id,
			projectName: row.project_name,
			status: row.finder_status
		}));
	}

	previewSessionDelete(projectId: string | null, sessionId: string) {
		if (!this.hasSession(projectId, sessionId)) return null;
		const counts = this.database
			.query(
				`SELECT
				 (SELECT COUNT(*) FROM messages WHERE project_id IS ? AND session_id = ?) AS messages,
				 (SELECT COUNT(*) FROM session_events WHERE project_id IS ? AND session_id = ?) AS events,
				 (SELECT COUNT(*) FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.project_id IS ? AND m.session_id = ?) AS attachments,
				 (SELECT COUNT(*) FROM messages WHERE project_id IS ? AND session_id = ? AND status IN ('queued','running','unknown')) AS active_deliveries`
			)
			.get(
				projectId,
				sessionId,
				projectId,
				sessionId,
				projectId,
				sessionId,
				projectId,
				sessionId
			) as {
			messages: number;
			events: number;
			attachments: number;
			active_deliveries: number;
		};
		return {
			sessionId,
			messages: counts.messages,
			events: counts.events,
			attachments: counts.attachments,
			activeDeliveries: counts.active_deliveries,
			reversibleAlternative: 'archive' as const
		};
	}

	deleteSession(projectId: string | null, sessionId: string): boolean {
		const impact = this.previewSessionDelete(projectId, sessionId);
		if (!impact) return false;
		if (impact.activeDeliveries) throw new Error('Session has active message deliveries');
		return this.database.transaction(() => {
			this.database
				.query(
					'INSERT OR REPLACE INTO dismissed_sessions (project_scope, session_id, dismissed_at) VALUES (?, ?, ?)'
				)
				.run(projectId ?? '', sessionId, new Date().toISOString());
			this.database
				.query('DELETE FROM session_events WHERE project_id IS ? AND session_id = ?')
				.run(projectId, sessionId);
			this.database
				.query('DELETE FROM messages WHERE project_id IS ? AND session_id = ?')
				.run(projectId, sessionId);
			return (
				this.database
					.query('DELETE FROM project_sessions WHERE project_id IS ? AND session_id = ?')
					.run(projectId, sessionId).changes > 0
			);
		})();
	}

	isSessionDismissed(projectId: string | null, sessionId: string): boolean {
		return !!this.database
			.query('SELECT 1 FROM dismissed_sessions WHERE project_scope = ? AND session_id = ?')
			.get(projectId ?? '', sessionId);
	}

	private mapSession(row: SessionRow): StoredSession {
		return {
			sessionId: row.session_id,
			cwd: row.cwd,
			icon: row.icon,
			title: row.title,
			workMode: parseWorkMode(row.work_mode) ?? DEFAULT_WORK_MODE,
			pinned: !!row.pinned,
			archived: !!row.archived,
			folder: row.folder,
			tags: JSON.parse(row.tags) as string[],
			updatedAt: row.updated_at
		};
	}

	updateSessionWorkMode(
		projectId: string | null,
		sessionId: string,
		workMode: WorkMode,
		source: string,
		withEvent: false
	): { session: StoredSession; event: SessionEvent | null };
	updateSessionWorkMode(
		projectId: string | null,
		sessionId: string,
		workMode: WorkMode,
		source: string,
		withEvent: true
	): { session: StoredSession; event: SessionEvent | null };
	updateSessionWorkMode(
		projectId: string | null,
		sessionId: string,
		workMode: WorkMode,
		source: string
	): StoredSession;
	updateSessionWorkMode(
		projectId: string | null,
		sessionId: string,
		workMode: WorkMode,
		source: string,
		withEvent = false
	): StoredSession | { session: StoredSession; event: SessionEvent | null } {
		const current = this.getSession(projectId, sessionId);
		if (!current) throw new Error('Session not found');
		const nextMode = parseWorkMode(workMode);
		if (!nextMode) throw new Error('workMode must be autonomous or live');
		if (current.workMode === nextMode) {
			return withEvent ? { session: current, event: null } : current;
		}
		const result = this.database.transaction(() => {
			this.database
				.query(
					'UPDATE project_sessions SET work_mode = ?, updated_at = ? WHERE project_id IS ? AND session_id = ?'
				)
				.run(nextMode, new Date().toISOString(), projectId, sessionId);
			const session = this.getSession(projectId, sessionId)!;
			const event = this.appendEvent(projectId, sessionId, 'session.work_mode_changed', {
				priorMode: current.workMode,
				workMode: nextMode,
				source
			});
			return { session, event };
		})();
		return withEvent ? result : result.session;
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
					`SELECT m.id, m.project_id, m.session_id, m.text, m.review_contexts, m.status, m.created_at, m.updated_at, ps.cwd
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
				review_contexts: string;
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

	listLegacyProjects(): Project[] {
		const rows = this.database
			.query(
				'SELECT id, name, root_path, icon, created_at FROM projects WHERE legacy = 1 ORDER BY created_at, id'
			)
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

	ensureProjectMetadata(id: string): void {
		if (!id.trim() || id.includes('\0')) throw new Error('Hermes Project id is invalid');
		if (this.hasProjectMetadata(id)) return;
		this.database
			.query(
				'INSERT INTO projects (id, name, root_path, icon, legacy, created_at) VALUES (?, ?, ?, NULL, 0, ?)'
			)
			.run(id, '', `hue-hermes-project:${encodeURIComponent(id)}`, new Date().toISOString());
	}

	hasProjectMetadata(id: string): boolean {
		return !!this.database.query('SELECT 1 FROM projects WHERE id = ?').get(id);
	}

	getProjectColor(id: string): string | null {
		return (
			(
				this.database.query('SELECT color FROM projects WHERE id = ?').get(id) as {
					color: string | null;
				} | null
			)?.color ?? null
		);
	}

	updateProjectColor(id: string, color: string): void {
		const result = this.database
			.query('UPDATE projects SET color = ? WHERE id = ?')
			.run(validateProjectColor(color), id);
		if (!result.changes) throw new Error('Project metadata was not found');
	}

	getProjectGroup(id: string): string | null {
		const row = this.database.query('SELECT group_name FROM projects WHERE id = ?').get(id) as {
			group_name: string | null;
		} | null;
		if (!row) throw new Error('Project metadata was not found');
		return row.group_name;
	}

	updateProjectGroup(id: string, group: string | null): void {
		const normalized = group?.trim() || null;
		if (normalized && (normalized.length > 100 || normalized.includes('\0'))) {
			throw new Error('Project group is invalid');
		}
		const result = this.database
			.query('UPDATE projects SET group_name = ? WHERE id = ?')
			.run(normalized, id);
		if (!result.changes) throw new Error('Project metadata was not found');
	}

	getProjectExcalidraw(projectId: string): ProjectExcalidraw | null {
		const row = this.database
			.query(
				'SELECT project_id, address, scene, updated_at FROM project_excalidraw WHERE project_id = ?'
			)
			.get(projectId) as {
			project_id: string;
			address: string;
			scene: string;
			updated_at: string;
		} | null;
		return row
			? {
					projectId: row.project_id,
					address: row.address,
					scene: row.scene,
					updatedAt: row.updated_at
				}
			: null;
	}

	updateProjectExcalidraw(
		projectId: string,
		input: { address?: string; scene?: string }
	): ProjectExcalidraw {
		if (input.address === undefined && input.scene === undefined) {
			throw new Error('Excalidraw address or scene is required');
		}
		const now = new Date().toISOString();
		this.database
			.query(
				`INSERT INTO project_excalidraw (project_id, address, scene, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(project_id) DO UPDATE SET
				 address = CASE WHEN ? THEN excluded.address ELSE project_excalidraw.address END,
				 scene = CASE WHEN ? THEN excluded.scene ELSE project_excalidraw.scene END,
				 updated_at = excluded.updated_at`
			)
			.run(
				projectId,
				input.address ?? '',
				input.scene ?? '',
				now,
				input.address === undefined ? 0 : 1,
				input.scene === undefined ? 0 : 1
			);
		return this.getProjectExcalidraw(projectId)!;
	}

	adoptHermesProject(legacyId: string, hermesId: string): void {
		if (
			!legacyId.trim() ||
			!hermesId.trim() ||
			legacyId.includes('\0') ||
			hermesId.includes('\0')
		) {
			throw new Error('Project id is invalid');
		}
		this.database.transaction(() => {
			const legacy = this.database
				.query('SELECT 1 FROM projects WHERE id = ? AND legacy = 1')
				.get(legacyId);
			if (!legacy) throw new Error(`Legacy Project ${legacyId} was not found`);
			if (legacyId === hermesId) {
				this.database.query('UPDATE projects SET legacy = 0 WHERE id = ?').run(legacyId);
				return;
			}
			this.ensureProjectMetadata(hermesId);
			this.database
				.query(
					`UPDATE projects SET
					 color = COALESCE(color, (SELECT color FROM projects WHERE id = ?)),
					 group_name = COALESCE(group_name, (SELECT group_name FROM projects WHERE id = ?))
					 WHERE id = ?`
				)
				.run(legacyId, legacyId, hermesId);
			this.database
				.query(
					`INSERT OR IGNORE INTO project_excalidraw (project_id, address, scene, updated_at)
					 SELECT ?, address, scene, updated_at FROM project_excalidraw WHERE project_id = ?`
				)
				.run(hermesId, legacyId);
			this.database.query('DELETE FROM project_excalidraw WHERE project_id = ?').run(legacyId);
			for (const table of ['workflows', 'project_sessions', 'messages', 'session_events']) {
				this.database
					.query(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`)
					.run(hermesId, legacyId);
			}
			this.database
				.query(
					`INSERT OR IGNORE INTO dismissed_sessions (project_scope, session_id, dismissed_at)
					 SELECT ?, session_id, dismissed_at FROM dismissed_sessions WHERE project_scope = ?`
				)
				.run(hermesId, legacyId);
			this.database.query('DELETE FROM dismissed_sessions WHERE project_scope = ?').run(legacyId);
			this.database.query('DELETE FROM projects WHERE id = ?').run(legacyId);
		})();
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

	hasActiveProjectDeliveries(id: string): boolean {
		return Boolean(
			this.database
				.query(
					"SELECT 1 FROM messages WHERE project_id = ? AND status IN ('queued', 'running', 'unknown') LIMIT 1"
				)
				.get(id)
		);
	}

	deleteProject(id: string): boolean {
		return this.database.transaction(() => {
			if (this.hasActiveProjectDeliveries(id)) {
				throw new Error('Project has active message deliveries');
			}
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
		workMode?: WorkMode;
	}): Workflow {
		const createdAt = new Date().toISOString();
		const profile = input.profile ?? 'default';
		const workMode = input.workMode ?? DEFAULT_WORK_MODE;
		this.database
			.query(
				'INSERT INTO workflows (id, project_id, name, prompt, profile, work_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.run(
				input.id,
				input.projectId,
				input.name,
				input.prompt,
				profile,
				workMode,
				createdAt,
				createdAt
			);
		return { ...input, profile, workMode, archived: false, createdAt, updatedAt: createdAt };
	}

	listWorkflows(projectId: string, includeArchived = false): Workflow[] {
		const rows = this.database
			.query(
				`SELECT id, project_id, name, prompt, profile, work_mode, archived, created_at, updated_at
				 FROM workflows WHERE project_id = ? ${includeArchived ? '' : 'AND archived = 0'}
				 ORDER BY archived, updated_at DESC, id`
			)
			.all(projectId) as Array<{
			id: string;
			project_id: string;
			name: string;
			prompt: string;
			profile: string;
			work_mode: string;
			archived: number;
			created_at: string;
			updated_at: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			projectId: row.project_id,
			name: row.name,
			prompt: row.prompt,
			profile: row.profile,
			workMode: parseWorkMode(row.work_mode) ?? DEFAULT_WORK_MODE,
			archived: Boolean(row.archived),
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}));
	}

	updateWorkflow(
		projectId: string,
		id: string,
		patch: Partial<Pick<Workflow, 'name' | 'prompt' | 'profile' | 'workMode' | 'archived'>>
	): Workflow | null {
		const current = this.listWorkflows(projectId, true).find((workflow) => workflow.id === id);
		if (!current) return null;
		const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
		this.database
			.query(
				`UPDATE workflows SET name = ?, prompt = ?, profile = ?, work_mode = ?, archived = ?, updated_at = ?
				 WHERE id = ? AND project_id = ?`
			)
			.run(
				updated.name,
				updated.prompt,
				updated.profile,
				updated.workMode,
				updated.archived ? 1 : 0,
				updated.updatedAt,
				id,
				projectId
			);
		return updated;
	}

	deleteWorkflow(projectId: string, id: string): boolean {
		return (
			this.database
				.query('DELETE FROM workflows WHERE id = ? AND project_id = ?')
				.run(id, projectId).changes > 0
		);
	}

	acceptMessage(input: {
		id: string;
		projectId: string | null;
		sessionId: string;
		text: string;
		images?: ImageAttachment[];
		attachments?: InputAttachment[];
		reviewContexts?: ReviewContext[];
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
		const attachments = normalizeStoredAttachments(input.images ?? [], input.attachments ?? []);
		if (existing) {
			if (
				existing.projectId !== input.projectId ||
				existing.sessionId !== input.sessionId ||
				existing.text !== input.text ||
				JSON.stringify(existing.reviewContexts) !== JSON.stringify(input.reviewContexts ?? []) ||
				JSON.stringify(normalizeStoredAttachments(existing.images, existing.attachments)) !==
					JSON.stringify(attachments)
			) {
				throw new MessageConflictError(input.id);
			}
			return { duplicate: true, status: existing.status };
		}

		const now = new Date().toISOString();
		this.database.transaction(() => {
			this.database
				.query(
					'INSERT INTO messages (id, project_id, session_id, text, review_contexts, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
				)
				.run(
					input.id,
					input.projectId,
					input.sessionId,
					input.text,
					JSON.stringify(input.reviewContexts ?? []),
					'queued',
					now,
					now
				);
			const insertAttachment = this.database.query(
				'INSERT INTO message_attachments (message_id, position, name, mime_type, data, size) VALUES (?, ?, ?, ?, ?, ?)'
			);
			for (const [position, attachment] of attachments.entries()) {
				insertAttachment.run(
					input.id,
					position,
					attachment.name,
					attachment.mimeType,
					attachment.data ?? '',
					attachment.size
				);
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
				'SELECT id, project_id, session_id, text, review_contexts, status, created_at, updated_at FROM messages WHERE id = ?'
			)
			.get(id) as {
			id: string;
			project_id: string | null;
			session_id: string;
			text: string;
			review_contexts: string;
			status: MessageStatus;
			created_at: string;
			updated_at: string;
		} | null;
		return row ? this.mapMessage(row) : null;
	}

	listMessages(projectId: string | null, sessionId: string): StoredMessage[] {
		const rows = this.database
			.query(
				'SELECT id, project_id, session_id, text, review_contexts, status, created_at, updated_at FROM messages WHERE project_id IS ? AND session_id = ? ORDER BY created_at, id'
			)
			.all(projectId, sessionId) as Array<{
			id: string;
			project_id: string | null;
			session_id: string;
			text: string;
			review_contexts: string;
			status: MessageStatus;
			created_at: string;
			updated_at: string;
		}>;
		return rows.map((row) => this.mapMessage(row));
	}

	updateQueuedMessage(
		id: string,
		input: {
			projectId: string | null;
			sessionId: string;
			text: string;
			images: ImageAttachment[];
			attachments?: InputAttachment[];
			reviewContexts?: ReviewContext[];
		}
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
				.query(
					'UPDATE messages SET text = ?, review_contexts = ?, updated_at = ? WHERE id = ? AND status = ?'
				)
				.run(
					input.text,
					JSON.stringify(input.reviewContexts ?? message.reviewContexts),
					updatedAt,
					id,
					'queued'
				);
			if (input.attachments !== undefined || input.images.length) {
				this.database.query('DELETE FROM message_attachments WHERE message_id = ?').run(id);
				const insert = this.database.query(
					'INSERT INTO message_attachments (message_id, position, name, mime_type, data, size) VALUES (?, ?, ?, ?, ?, ?)'
				);
				for (const [position, attachment] of normalizeStoredAttachments(
					input.images,
					input.attachments ?? []
				).entries()) {
					insert.run(
						id,
						position,
						attachment.name,
						attachment.mimeType,
						attachment.data ?? '',
						attachment.size
					);
				}
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

	getSessionIndicators(projectId: string | null): Record<
		string,
		{
			attention: boolean;
			error: boolean;
			status:
				| 'running'
				| 'waiting-permission'
				| 'waiting-answer'
				| 'unknown'
				| 'failed'
				| 'cancelled'
				| null;
			unreadAttention: boolean;
		}
	> {
		const rows = this.database
			.query(
				`
			WITH latest_message AS (
				SELECT session_id, status,
					ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS rank
				FROM messages WHERE project_id IS ?
			), latest_interaction AS (
				SELECT session_id, type, json_extract(payload, '$.status') AS status,
					ROW_NUMBER() OVER (
						PARTITION BY session_id, type, json_extract(payload, '$.id') ORDER BY sequence DESC
					) AS rank
				FROM session_events
				WHERE project_id IS ? AND type IN ('agent.permission', 'agent.clarify')
			), latest_terminal AS (
				SELECT session_id, type,
					ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY sequence DESC) AS rank
				FROM session_events
				WHERE project_id IS ? AND type IN ('message.completed', 'message.failed', 'message.unknown', 'message.cancelled')
			)
			SELECT ps.session_id,
				MAX(CASE WHEN lm.status IN ('failed', 'unknown') AND COALESCE(lt.type, '') != 'message.cancelled' THEN 1 ELSE 0 END) AS error,
				MAX(CASE WHEN li.status = 'pending' THEN 1 ELSE 0 END) AS pending,
				CASE
					WHEN MAX(CASE WHEN lt.type = 'message.cancelled' THEN 1 ELSE 0 END) = 1 THEN 'cancelled'
					WHEN MAX(CASE WHEN li.type = 'agent.clarify' AND li.status = 'pending' THEN 1 ELSE 0 END) = 1 THEN 'waiting-answer'
					WHEN MAX(CASE WHEN li.type = 'agent.permission' AND li.status = 'pending' THEN 1 ELSE 0 END) = 1 THEN 'waiting-permission'
					WHEN MAX(CASE WHEN lm.status = 'unknown' THEN 1 ELSE 0 END) = 1 THEN 'unknown'
					WHEN MAX(CASE WHEN lm.status = 'failed' THEN 1 ELSE 0 END) = 1 THEN 'failed'
					WHEN MAX(CASE WHEN lm.status IN ('queued', 'running') THEN 1 ELSE 0 END) = 1 THEN 'running'
					ELSE NULL
				END AS status,
				EXISTS(
					SELECT 1 FROM notifications n
					WHERE n.project_id IS ps.project_id AND n.session_id = ps.session_id
						AND n.read_at IS NULL AND n.dismissed_at IS NULL
				) AS unread_attention
			FROM project_sessions ps
			LEFT JOIN latest_message lm ON lm.session_id = ps.session_id AND lm.rank = 1
			LEFT JOIN latest_interaction li ON li.session_id = ps.session_id AND li.rank = 1
			LEFT JOIN latest_terminal lt ON lt.session_id = ps.session_id AND lt.rank = 1
			WHERE ps.project_id IS ?
			GROUP BY ps.session_id
		`
			)
			.all(projectId, projectId, projectId, projectId) as Array<{
			session_id: string;
			error: number;
			pending: number;
			status:
				| 'running'
				| 'waiting-permission'
				| 'waiting-answer'
				| 'unknown'
				| 'failed'
				| 'cancelled'
				| null;
			unread_attention: number;
		}>;
		return Object.fromEntries(
			rows.map((row) => [
				row.session_id,
				{
					attention: !!row.error || !!row.pending,
					error: !!row.error,
					status: row.status,
					unreadAttention: !!row.unread_attention
				}
			])
		);
	}

	private mapMessage(row: {
		id: string;
		project_id: string | null;
		session_id: string;
		text: string;
		review_contexts: string;
		status: MessageStatus;
		created_at: string;
		updated_at: string;
	}): StoredMessage {
		const attachments = this.database
			.query(
				'SELECT name, mime_type, data, size FROM message_attachments WHERE message_id = ? ORDER BY position'
			)
			.all(row.id)
			.map((attachment) => {
				const value = attachment as {
					name: string;
					mime_type: string;
					data: string;
					size: number | null;
				};
				return {
					name: value.name,
					mimeType: value.mime_type,
					data: value.data,
					size: value.size ?? Buffer.from(value.data, 'base64').byteLength
				};
			});
		return {
			id: row.id,
			projectId: row.project_id,
			sessionId: row.session_id,
			text: row.text,
			reviewContexts: JSON.parse(row.review_contexts) as ReviewContext[],
			images: attachments
				.filter(({ mimeType, data }) => mimeType.startsWith('image/') && data)
				.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
			attachments: attachments
				.filter(({ mimeType, data }) => !mimeType.startsWith('image/') || !data)
				.map(({ name, mimeType, size }) => ({
					name,
					mimeType,
					size,
					available: false,
					reattachRequired: true
				})),
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

	transitionCancelledMessage(id: string): void {
		const message = this.getMessage(id);
		if (!message) throw new Error(`Message ${id} was not found`);
		this.database.transaction(() => {
			this.updateMessageStatus(id, 'cancelled');
			this.appendEvent(message.projectId, message.sessionId, 'message.cancelled', {
				messageId: id
			});
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
		let sequence = 0;
		this.database.transaction(() => {
			const result = this.database
				.query(
					'INSERT INTO session_events (project_id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
				)
				.run(projectId, sessionId, type, JSON.stringify(redactedPayload), createdAt);
			sequence = Number(result.lastInsertRowid);
			if (
				['message.completed', 'message.failed', 'message.unknown', 'message.cancelled'].includes(
					type
				) ||
				(['agent.permission', 'agent.clarify'].includes(type) &&
					redactedPayload.status === 'pending')
			) {
				this.insertNotification({
					sequence,
					project_id: projectId,
					session_id: sessionId,
					type,
					created_at: createdAt
				});
			}
		})();
		return {
			sequence,
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

function secureDatabasePath(filename: string): void {
	const directory = dirname(filename);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const directoryStat = lstatSync(directory);
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
		throw new Error('HUE database directory must be a real directory');
	}
	if ((directoryStat.mode & 0o777) !== 0o700) chmodSync(directory, 0o700);
	try {
		const fileStat = lstatSync(filename);
		if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
			throw new Error('HUE database must be a regular file');
		}
		if ((fileStat.mode & 0o777) !== 0o600) chmodSync(filename, 0o600);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
}
