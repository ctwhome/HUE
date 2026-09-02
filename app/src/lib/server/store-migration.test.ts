import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateHueBackup } from './runtime-reliability';
import { HUE_SCHEMA_VERSION, HUEStore } from './store';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryDatabase(name: string): { root: string; path: string } {
	const root = join(tmpdir(), `hue-${name}-${crypto.randomUUID()}`);
	roots.push(root);
	return { root, path: join(root, 'hue.db') };
}

function createHistoricalCancelledSchema(path: string): void {
	const store = new HUEStore(path);
	store.ensureProjectMetadata('hue', 'HUE');
	store.createWorkflow({
		id: 'release',
		projectId: 'hue',
		name: 'Release',
		prompt: 'Ship without losing state.',
		bundle: 'live'
	});
	store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	store.updateSession('hue', 'session-1', {
		title: 'Migration proof',
		pinned: true,
		folder: 'Delivery',
		tags: ['migration']
	});
	store.acceptMessage({
		id: 'message-1',
		projectId: 'hue',
		sessionId: 'session-1',
		text: 'Preserve this envelope.',
		reviewContexts: [
			{
				id: 'review-1',
				source: 'diff',
				label: 'Migration diff',
				content: 'Keep the transaction.',
				comment: 'Verified.'
			}
		],
		images: [{ name: 'proof.png', mimeType: 'image/png', data: 'aGVsbG8=' }]
	});
	store.transitionMessage('message-1', 'running', { messageId: 'message-1' });
	store.transitionMessage('message-1', 'unknown', {
		messageId: 'message-1',
		error: 'Delivery outcome unknown'
	});
	store.database
		.query(
			`INSERT INTO notification_endpoints
			 (id, device_id, name, endpoint, p256dh, auth, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			'endpoint-1',
			'device-1',
			'Phone',
			'https://push.example/1',
			'encrypted-p256dh',
			'encrypted-auth',
			'2026-08-27T00:00:00.000Z',
			'2026-08-27T00:00:00.000Z'
		);
	store.database
		.query(
			`INSERT INTO notification_delivery_attempts
			 (id, notification_id, endpoint_id, status, attempt_count, error_category, next_attempt_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			'attempt-1',
			'notification:3',
			'endpoint-1',
			'retry',
			2,
			'network',
			'2026-08-27T00:05:00.000Z',
			'2026-08-27T00:00:00.000Z',
			'2026-08-27T00:01:00.000Z'
		);
	expect(store.getMessage('message-1')?.status).toBe('unknown');
	store.close();
	rmSync(`${path}.attachments`, { recursive: true, force: true });

	const database = new Database(path, { strict: true });
	expect(database.query('SELECT id, status FROM messages').all()).toEqual([
		{ id: 'message-1', status: 'unknown' }
	]);
	const message = database.query('SELECT * FROM messages').get() as Record<string, string>;
	const attachment = database.query('SELECT * FROM message_attachments').get() as Record<
		string,
		string | number
	>;
	database.exec(`
		PRAGMA foreign_keys = OFF;
		DROP TABLE message_attachments;
		DROP TABLE messages;
		CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			project_id TEXT REFERENCES projects(id),
			session_id TEXT NOT NULL,
			text TEXT NOT NULL,
			review_contexts TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'unknown')),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE message_attachments (
			message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
			position INTEGER NOT NULL,
			name TEXT NOT NULL,
			mime_type TEXT NOT NULL,
			data TEXT NOT NULL,
			size INTEGER,
			PRIMARY KEY (message_id, position)
		);
		PRAGMA user_version = 0;
	`);
	database
		.query('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.run(
			message.id,
			message.project_id,
			message.session_id,
			message.text,
			message.review_contexts,
			message.status,
			message.created_at,
			message.updated_at
		);
	database
		.query('INSERT INTO message_attachments VALUES (?, ?, ?, ?, ?, ?)')
		.run(
			attachment.message_id,
			attachment.position,
			attachment.name,
			attachment.mime_type,
			'aGVsbG8=',
			attachment.size
		);
	database.close();
}

function createHistoricalRequiredProjectSessionSchema(path: string): void {
	const store = new HUEStore(path);
	store.ensureProjectMetadata('hue', 'HUE');
	store.close();

	const database = new Database(path, { strict: true });
	database.exec(`
		PRAGMA foreign_keys = OFF;
		DROP TABLE project_sessions;
		CREATE TABLE project_sessions (
			session_id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			cwd TEXT NOT NULL,
			icon TEXT,
			updated_at TEXT NOT NULL
		);
		INSERT INTO project_sessions VALUES
			('session-1', 'hue', '/work/hue', NULL, '2026-08-27T00:00:00.000Z');
		PRAGMA user_version = 0;
	`);
	database.close();
}

describe('HUEStore versioned migrations', () => {
	it('adds Workflow folders to version 1 databases without rewriting existing data', () => {
		const { root, path } = temporaryDatabase('workflow-folders-migration');
		mkdirSync(root, { recursive: true });
		const database = new Database(path);
		database.exec(`
			CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, icon TEXT, group_name TEXT, legacy INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, color TEXT);
			CREATE TABLE workflows (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, prompt TEXT NOT NULL, profile TEXT NOT NULL DEFAULT 'default', work_mode TEXT NOT NULL DEFAULT 'autonomous', archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			INSERT INTO projects VALUES ('hue', 'HUE', '/work/hue', NULL, NULL, 0, '2026-08-27T00:00:00.000Z', NULL);
			INSERT INTO workflows VALUES ('release', 'hue', 'Release', 'Run checks.', 'default', 'autonomous', 0, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z');
			PRAGMA user_version = 1;
		`);
		database.close();

		const store = new HUEStore(path);
		expect(store.listWorkflows('hue')[0]).toMatchObject({ id: 'release', folder: null });
		expect(store.database.query('PRAGMA user_version').get()).toEqual({
			user_version: HUE_SCHEMA_VERSION
		});
		store.close();
		expect(readdirSync(root).sort()).toEqual(['backups', 'hue.db']);
	});

	it('adds Workflow favorites to version 2 databases without a backup', () => {
		const { root, path } = temporaryDatabase('workflow-favorites-migration');
		const initial = new HUEStore(path);
		initial.ensureProjectMetadata('hue', 'HUE');
		initial.createWorkflow({ id: 'release', projectId: 'hue', name: 'Release', prompt: 'Ship.' });
		initial.close();
		const historical = new Database(path);
		historical.exec('ALTER TABLE workflows DROP COLUMN favorite; PRAGMA user_version = 2;');
		historical.close();

		const migrated = new HUEStore(path);
		expect(migrated.listWorkflows('hue')[0]).toMatchObject({ id: 'release', favorite: false });
		migrated.close();
		expect(readdirSync(root)).toEqual(['hue.db']);
	});

	it('adds HUE-owned schedules to version 3 databases without rewriting existing state', () => {
		const { root, path } = temporaryDatabase('schedule-migration');
		const initial = new HUEStore(path);
		initial.ensureProjectMetadata('hue', 'HUE');
		initial.close();
		const historical = new Database(path);
		historical.exec('DROP TABLE schedules; PRAGMA user_version = 3;');
		historical.close();

		const migrated = new HUEStore(path);
		expect(migrated.listSchedules()).toEqual([]);
		expect(migrated.hasProjectMetadata('hue')).toBe(true);
		migrated.close();
		expect(readdirSync(root)).toEqual(['hue.db']);
	});

	it('adds commit-generation reservations to version 4 databases without a backup', () => {
		const { root, path } = temporaryDatabase('commit-generation-migration');
		const initial = new HUEStore(path);
		initial.close();
		const historical = new Database(path);
		historical.exec('DROP TABLE commit_generations; PRAGMA user_version = 4;');
		historical.close();

		const migrated = new HUEStore(path);
		expect(
			migrated.database
				.query(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'commit_generations'"
				)
				.get()
		).toEqual({ name: 'commit_generations' });
		migrated.close();
		expect(readdirSync(root)).toEqual(['hue.db']);
	});

	it('backs up version 5 and additively migrates Workflow work modes to bundle references', () => {
		const { root, path } = temporaryDatabase('workflow-bundle-migration');
		const initial = new HUEStore(path);
		initial.ensureProjectMetadata('hue', 'HUE');
		initial.close();
		const historical = new Database(path);
		historical.exec(`
			ALTER TABLE workflows DROP COLUMN bundle;
			ALTER TABLE workflows ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'autonomous';
			INSERT INTO workflows
			 (id, project_id, name, prompt, folder, favorite, profile, work_mode, archived, created_at, updated_at)
			 VALUES
			 ('auto', 'hue', 'Auto', 'Run.', NULL, 0, 'default', 'autonomous', 0, '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z'),
			 ('live', 'hue', 'Live', 'Pair.', NULL, 0, 'default', 'live', 0, '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z');
			PRAGMA user_version = 5;
		`);
		historical.close();

		const migrated = new HUEStore(path);
		expect(migrated.listWorkflows('hue').map(({ id, bundle }) => ({ id, bundle }))).toEqual([
			{ id: 'auto', bundle: 'autonomous' },
			{ id: 'live', bundle: 'live' }
		]);
		expect(migrated.database.query('PRAGMA table_info(workflows)').all()).toContainEqual(
			expect.objectContaining({ name: 'work_mode' })
		);
		migrated.close();

		const backups = readdirSync(join(root, 'backups'));
		expect(backups).toHaveLength(1);
		const backup = new Database(join(root, 'backups', backups[0]!), {
			readonly: true,
			strict: true
		});
		expect(backup.query('PRAGMA user_version').get()).toEqual({ user_version: 5 });
		expect(backup.query('SELECT id, work_mode FROM workflows ORDER BY id').all()).toEqual([
			{ id: 'auto', work_mode: 'autonomous' },
			{ id: 'live', work_mode: 'live' }
		]);
		backup.close();
	});

	it('adds external Hermes cron tracking to version 6 databases without a backup', () => {
		const { root, path } = temporaryDatabase('external-cron-migration');
		const initial = new HUEStore(path);
		initial.ensureProjectMetadata('hue', 'HUE');
		initial.close();
		const historical = new Database(path);
		historical.exec(`
			ALTER TABLE workflows ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'autonomous';
			INSERT INTO workflows
			 (id, project_id, name, prompt, profile, bundle, created_at, updated_at, work_mode)
			 VALUES ('custom', 'hue', 'Custom', 'Run.', 'default', 'release-ready',
			 '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z', 'live');
			DROP TABLE external_cron_runs;
			DROP TABLE external_cron_state;
			PRAGMA user_version = 6;
		`);
		historical.close();

		const migrated = new HUEStore(path);
		expect(migrated.externalCronInitialized()).toBe(false);
		expect(migrated.listExternalCronRuns('default', 'job-1')).toEqual([]);
		expect(migrated.listWorkflows('hue')[0]?.bundle).toBe('release-ready');
		migrated.close();
		expect(readdirSync(root)).toEqual(['hue.db']);
	});

	it('versions a fresh database and reopens it without schema writes or backups', () => {
		const { root, path } = temporaryDatabase('fresh-migration');
		const store = new HUEStore(path);
		expect(store.database.query('PRAGMA user_version').get()).toEqual({
			user_version: HUE_SCHEMA_VERSION
		});
		const schemaVersion = store.database.query('PRAGMA schema_version').get();
		store.close();

		const reopened = new HUEStore(path);
		expect(reopened.database.query('PRAGMA schema_version').get()).toEqual(schemaVersion);
		reopened.close();
		expect(readdirSync(root)).toEqual(['hue.db']);
	});

	it('backs up and migrates the cancelled-status schema without losing HUE state', () => {
		const { root, path } = temporaryDatabase('historical-migration');
		createHistoricalCancelledSchema(path);

		const store = new HUEStore(path);

		expect(store.database.query('PRAGMA user_version').get()).toEqual({
			user_version: HUE_SCHEMA_VERSION
		});
		expect(store.getMessage('message-1')).toMatchObject({
			text: 'Preserve this envelope.',
			status: 'unknown',
			reviewContexts: [expect.objectContaining({ id: 'review-1', comment: 'Verified.' })],
			images: [expect.objectContaining({ name: 'proof.png' })]
		});
		const attachment = store.database
			.query('SELECT data, file_path FROM message_attachments WHERE message_id = ?')
			.get('message-1') as { data: string; file_path: string };
		expect(attachment.data).toBe('');
		expect(readFileSync(join(`${path}.attachments`, attachment.file_path)).toString()).toBe(
			'hello'
		);
		expect(store.listWorkflows('hue')).toEqual([
			expect.objectContaining({
				id: 'release',
				prompt: 'Ship without losing state.',
				bundle: 'live'
			})
		]);
		expect(store.getSession('hue', 'session-1')).toMatchObject({
			title: 'Migration proof',
			pinned: true,
			folder: 'Delivery',
			tags: ['migration']
		});
		const events = store.listEvents('hue', 'session-1');
		expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
		expect(events.map(({ type }) => type)).toEqual([
			'message.accepted',
			'message.running',
			'message.unknown'
		]);
		expect(store.listNotifications({}).items).toEqual([
			expect.objectContaining({ sourceEventId: '3', kind: 'unknown', readAt: null })
		]);
		expect(
			store.database
				.query(
					'SELECT status, attempt_count, error_category FROM notification_delivery_attempts WHERE id = ?'
				)
				.get('attempt-1')
		).toEqual({ status: 'retry', attempt_count: 2, error_category: 'network' });
		expect(store.database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		store.close();

		const backups = readdirSync(join(root, 'backups'));
		expect(backups).toHaveLength(1);
		const backupPath = join(root, 'backups', backups[0]!);
		expect(lstatSync(join(root, 'backups')).mode & 0o777).toBe(0o700);
		expect(lstatSync(backupPath).mode & 0o777).toBe(0o600);
		expect(validateHueBackup(backupPath).ok).toBe(false);
		const historical = new Database(backupPath, { readonly: true, strict: true });
		expect(historical.query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
		expect(historical.query('PRAGMA user_version').get()).toEqual({ user_version: 0 });
		expect(historical.query('SELECT id, status FROM messages').all()).toEqual([
			{ id: 'message-1', status: 'unknown' }
		]);
		historical.close();
	});

	it('backs up before reconstructing project_sessions when messages need no rebuild', () => {
		const { root, path } = temporaryDatabase('project-sessions-migration');
		createHistoricalRequiredProjectSessionSchema(path);

		const store = new HUEStore(path);

		expect(store.getSession('hue', 'session-1')).toMatchObject({ cwd: '/work/hue' });
		expect(store.database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		store.close();
		const backups = readdirSync(join(root, 'backups'));
		expect(backups).toHaveLength(1);
		const historical = new Database(join(root, 'backups', backups[0]!), {
			readonly: true,
			strict: true
		});
		expect(historical.query('PRAGMA user_version').get()).toEqual({ user_version: 0 });
		expect(historical.query('SELECT session_id FROM project_sessions').all()).toEqual([
			{ session_id: 'session-1' }
		]);
		historical.close();
	});

	it('rolls back project_sessions reconstruction failure after creating one backup', () => {
		const { root, path } = temporaryDatabase('project-sessions-rollback');
		createHistoricalRequiredProjectSessionSchema(path);

		expect(
			() =>
				new HUEStore(path, {
					migrationFault: () => {
						throw new Error('injected migration failure');
					}
				})
		).toThrow('restore the backup to a fresh HUE database path');

		expect(readdirSync(join(root, 'backups'))).toHaveLength(1);
		const unchanged = new Database(path, { readonly: true, strict: true });
		expect(unchanged.query('PRAGMA user_version').get()).toEqual({ user_version: 0 });
		expect(
			unchanged
				.query(
					"SELECT [notnull] FROM pragma_table_info('project_sessions') WHERE name = 'project_id'"
				)
				.get()
		).toEqual({ notnull: 1 });
		unchanged.close();
	});

	it('keeps the old database intact and reports offline recovery when migration fails', () => {
		const { root, path } = temporaryDatabase('failed-migration');
		createHistoricalCancelledSchema(path);

		let error: Error | undefined;
		try {
			new HUEStore(path, {
				migrationFault: () => {
					throw new Error('injected migration failure');
				}
			});
		} catch (cause) {
			error = cause as Error;
		}

		const backups = readdirSync(join(root, 'backups'));
		expect(backups).toHaveLength(1);
		expect(error?.message).toContain(`schema migration 0 -> ${HUE_SCHEMA_VERSION}`);
		expect(error?.message).toContain(backups[0]!);
		expect(error?.message).toContain(
			'Stop HUE and restore the backup to a fresh HUE database path'
		);
		expect(error?.message).not.toContain(root);

		const unchanged = new Database(path, { readonly: true, strict: true });
		expect(unchanged.query('PRAGMA user_version').get()).toEqual({ user_version: 0 });
		expect(
			(
				unchanged
					.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
					.get() as { sql: string }
			).sql
		).not.toContain("'cancelled'");
		expect(unchanged.query('SELECT id, status FROM messages').all()).toEqual([
			{ id: 'message-1', status: 'unknown' }
		]);
		expect(unchanged.query('SELECT COUNT(*) AS count FROM message_attachments').get()).toEqual({
			count: 1
		});
		unchanged.close();
	});

	it('stops before schema writes when the required backup cannot be created', () => {
		const { root, path } = temporaryDatabase('backup-failure');
		createHistoricalCancelledSchema(path);
		writeFileSync(join(root, 'backups'), 'not a directory');

		expect(() => new HUEStore(path)).toThrow(
			`HUE schema migration 0 -> ${HUE_SCHEMA_VERSION} failed before schema changes. Backup: unavailable. Stop HUE and fix backup storage before retrying.`
		);

		const unchanged = new Database(path, { readonly: true, strict: true });
		expect(unchanged.query('PRAGMA user_version').get()).toEqual({ user_version: 0 });
		expect(
			(
				unchanged
					.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
					.get() as { sql: string }
			).sql
		).not.toContain("'cancelled'");
		unchanged.close();
	});
});
