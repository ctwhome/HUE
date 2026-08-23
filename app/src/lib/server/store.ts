import { createRequire } from 'node:module';
import type { Database as BunDatabase } from 'bun:sqlite';
import { validateIcon } from '$lib/icon';
import type { ImageAttachment, InputAttachment } from '$lib/message-content';
import { DEFAULT_WORK_MODE, parseWorkMode, type WorkMode } from '$lib/work-mode';
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
	attachments: InputAttachment[];
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
				legacy INTEGER NOT NULL DEFAULT 1,
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
		if (!projectColumns.some((column) => column.name === 'legacy')) {
			this.database.exec('ALTER TABLE projects ADD COLUMN legacy INTEGER NOT NULL DEFAULT 1');
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
		const attachmentColumns = this.database
			.query('PRAGMA table_info(message_attachments)')
			.all() as Array<{ name: string }>;
		if (!attachmentColumns.some((column) => column.name === 'size')) {
			this.database.exec('ALTER TABLE message_attachments ADD COLUMN size INTEGER');
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
				CREATE INDEX IF NOT EXISTS session_events_project_type_cursor_idx
					ON session_events(project_id, type, session_id, sequence DESC);
			CREATE INDEX IF NOT EXISTS project_sessions_scope_list_idx
				ON project_sessions(project_id, archived, pinned DESC, updated_at DESC, session_id);
		`);
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
					'SELECT id, text, status, created_at, updated_at FROM messages WHERE project_id IS ? AND session_id = ? ORDER BY created_at, id'
				)
				.all(projectId, sourceSessionId) as Array<{
				id: string;
				text: string;
				status: MessageStatus;
				created_at: string;
				updated_at: string;
			}>;
			const ids = new Map(messages.map(({ id }) => [id, crypto.randomUUID()]));
			const insertMessage = this.database.query(
				'INSERT INTO messages (id, project_id, session_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
					"SELECT type, payload, created_at FROM session_events WHERE project_id IS ? AND session_id = ? AND type != 'agent.image' ORDER BY sequence"
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
		attachments?: InputAttachment[];
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
					'INSERT INTO messages (id, project_id, session_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
				)
				.run(input.id, input.projectId, input.sessionId, input.text, 'queued', now, now);
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
		input: {
			projectId: string | null;
			sessionId: string;
			text: string;
			images: ImageAttachment[];
			attachments?: InputAttachment[];
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
				.query('UPDATE messages SET text = ?, updated_at = ? WHERE id = ? AND status = ?')
				.run(input.text, updatedAt, id, 'queued');
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

	getSessionIndicators(
		projectId: string | null
	): Record<string, { attention: boolean; error: boolean }> {
		const rows = this.database
			.query(
				`
			WITH latest_message AS (
				SELECT session_id, status,
					ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS rank
				FROM messages WHERE project_id IS ?
			), latest_interaction AS (
				SELECT session_id, json_extract(payload, '$.status') AS status,
					ROW_NUMBER() OVER (
						PARTITION BY session_id, type, json_extract(payload, '$.id') ORDER BY sequence DESC
					) AS rank
				FROM session_events
				WHERE project_id IS ? AND type IN ('agent.permission', 'agent.clarify')
			)
			SELECT ps.session_id,
				MAX(CASE WHEN lm.status IN ('failed', 'unknown') THEN 1 ELSE 0 END) AS error,
				MAX(CASE WHEN li.status = 'pending' THEN 1 ELSE 0 END) AS pending
			FROM project_sessions ps
			LEFT JOIN latest_message lm ON lm.session_id = ps.session_id AND lm.rank = 1
			LEFT JOIN latest_interaction li ON li.session_id = ps.session_id AND li.rank = 1
			WHERE ps.project_id IS ?
			GROUP BY ps.session_id
		`
			)
			.all(projectId, projectId, projectId) as Array<{
			session_id: string;
			error: number;
			pending: number;
		}>;
		return Object.fromEntries(
			rows.map((row) => [
				row.session_id,
				{ attention: !!row.error || !!row.pending, error: !!row.error }
			])
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
