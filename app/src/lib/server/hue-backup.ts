import { chmodSync, copyFileSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Database as BunDatabase } from 'bun:sqlite';

const runtimeRequire = createRequire(import.meta.url);
export const HUE_SCHEMA_VERSION = 9;

const HUE_REQUIRED_COLUMNS = {
	projects: ['id', 'name', 'root_path', 'icon', 'group_name', 'legacy', 'created_at', 'color'],
	workflows: [
		'id',
		'project_id',
		'name',
		'prompt',
		'folder',
		'favorite',
		'profile',
		'bundle',
		'archived',
		'created_at',
		'updated_at'
	],
	project_excalidraw: ['project_id', 'address', 'scene', 'updated_at'],
	project_sessions: [
		'session_id',
		'project_id',
		'cwd',
		'icon',
		'work_mode',
		'updated_at',
		'title',
		'title_custom',
		'pinned',
		'archived',
		'folder',
		'tags'
	],
	dismissed_sessions: ['project_scope', 'session_id', 'dismissed_at'],
	messages: [
		'id',
		'session_id',
		'text',
		'review_contexts',
		'status',
		'created_at',
		'updated_at',
		'project_id'
	],
	message_attachments: ['message_id', 'position', 'name', 'mime_type', 'data', 'size', 'file_path'],
	session_events: ['sequence', 'session_id', 'type', 'payload', 'created_at', 'project_id'],
	notifications: [
		'id',
		'source_event_id',
		'project_id',
		'session_id',
		'kind',
		'priority',
		'title',
		'body',
		'path',
		'created_at',
		'read_at',
		'dismissed_at',
		'acted_at'
	],
	notification_endpoints: [
		'id',
		'device_id',
		'name',
		'endpoint',
		'p256dh',
		'auth',
		'enabled',
		'created_at',
		'updated_at',
		'revoked_at',
		'notification_baseline'
	],
	notification_delivery_attempts: [
		'id',
		'notification_id',
		'endpoint_id',
		'status',
		'attempt_count',
		'error_category',
		'next_attempt_at',
		'created_at',
		'updated_at',
		'accepted_at'
	],
	notification_presence: ['endpoint_id', 'project_id', 'session_id', 'visible', 'expires_at'],
	schedules: [
		'id',
		'name',
		'prompt',
		'cron',
		'enabled',
		'next_run_at',
		'session_id',
		'created_at',
		'updated_at'
	],
	external_cron_state: ['id', 'initialized_at'],
	external_cron_runs: [
		'profile',
		'profile_name',
		'job_id',
		'job_name',
		'session_id',
		'status',
		'started_at',
		'ended_at',
		'end_reason',
		'message_count',
		'discovered_at',
		'read_at',
		'event_sequence'
	],
	commit_generations: [
		'operation_id',
		'project_id',
		'repository_root',
		'prompt_hash',
		'model_id',
		'session_id',
		'status',
		'error',
		'created_at',
		'updated_at'
	],
	quick_asks: [
		'operation_id',
		'question_hash',
		'session_id',
		'status',
		'created_at',
		'updated_at'
	]
} as const;

type SchemaManifest = { version: number; tables: Record<string, string[]> };

const ATTACHMENT_FILE_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function schemaManifest(database: BunDatabase): SchemaManifest {
	const tables = database
		.query(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
		)
		.all() as Array<{ name: string }>;
	return {
		version: (database.query('PRAGMA user_version').get() as { user_version: number }).user_version,
		tables: Object.fromEntries(
			tables.map(({ name }) => [
				name,
				(
					database.query(`PRAGMA table_info(${JSON.stringify(name)})`).all() as Array<{
						name: string;
					}>
				).map((column) => column.name)
			])
		)
	};
}

export function validateHueBackup(
	path: string,
	expectedSource?: SchemaManifest
): { ok: boolean; error?: string } {
	let database: BunDatabase | undefined;
	try {
		const { Database } = runtimeRequire('bun:sqlite') as typeof import('bun:sqlite');
		database = new Database(path, { readonly: true, strict: true });
		const integrity = database.query<{ quick_check: string }, []>('PRAGMA quick_check').get();
		const manifest = schemaManifest(database);
		const validSchema = expectedSource
			? JSON.stringify(manifest) === JSON.stringify(expectedSource)
			: manifest.version === HUE_SCHEMA_VERSION &&
				Object.entries(HUE_REQUIRED_COLUMNS).every(([table, required]) => {
					const columns = new Set(manifest.tables[table]);
					return required.every((column) => columns.has(column));
				});
		const attachmentFilesValid = manifest.tables.message_attachments?.includes('file_path')
			? (
					database
						.query('SELECT file_path, size FROM message_attachments WHERE file_path IS NOT NULL')
						.all() as Array<{ file_path: string; size: number | null }>
				).every(({ file_path, size }) => {
					if (!ATTACHMENT_FILE_PATTERN.test(file_path)) return false;
					try {
						const stat = lstatSync(join(`${path}.attachments`, file_path));
						return (
							stat.isFile() &&
							!stat.isSymbolicLink() &&
							(stat.mode & 0o777) === 0o600 &&
							(size === null || stat.size === size)
						);
					} catch {
						return false;
					}
				})
			: true;
		if (
			integrity?.quick_check !== 'ok' ||
			database.query('PRAGMA foreign_key_check').all().length ||
			!validSchema ||
			!attachmentFilesValid
		) {
			return { ok: false, error: 'Backup failed HUE database validation' };
		}
		return { ok: true };
	} catch {
		return { ok: false, error: 'Backup is not a readable SQLite database' };
	} finally {
		database?.close();
	}
}

export function createHueDatabaseBackup(
	database: BunDatabase,
	sourceFilename: string,
	backupDirectory?: string,
	validateSourceSchema = false
) {
	if (sourceFilename === ':memory:') throw new Error('In-memory HUE databases cannot be backed up');
	const directory = backupDirectory ?? join(dirname(sourceFilename), 'backups');
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	const filename = `hue-${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}.sqlite`;
	const path = join(directory, filename);
	const sourceManifest = validateSourceSchema ? schemaManifest(database) : undefined;
	const attachmentDirectory = `${path}.attachments`;
	let attachmentsPath: string | null = null;
	try {
		database.query('VACUUM INTO ?').run(path);
		chmodSync(path, 0o600);
		const attachmentColumns = database
			.query("PRAGMA table_info('message_attachments')")
			.all() as Array<{ name: string }>;
		if (attachmentColumns.some(({ name }) => name === 'file_path')) {
			const filePaths = (
				database
					.query('SELECT file_path FROM message_attachments WHERE file_path IS NOT NULL')
					.all() as Array<{ file_path: string }>
			).map(({ file_path }) => file_path);
			if (filePaths.length) {
				mkdirSync(attachmentDirectory, { mode: 0o700 });
				attachmentsPath = attachmentDirectory;
				for (const filePath of filePaths) {
					if (!ATTACHMENT_FILE_PATTERN.test(filePath)) throw new Error('Invalid attachment path');
					const sourcePath = join(`${sourceFilename}.attachments`, filePath);
					const stat = lstatSync(sourcePath);
					if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid attachment file');
					const targetPath = join(attachmentDirectory, filePath);
					copyFileSync(sourcePath, targetPath);
					chmodSync(targetPath, 0o600);
				}
			}
		}
		const validation = validateHueBackup(path, sourceManifest);
		if (!validation.ok) throw new Error(validation.error);
		return { filename, path, attachmentsPath, validated: true as const };
	} catch (cause) {
		rmSync(path, { force: true });
		rmSync(attachmentDirectory, { recursive: true, force: true });
		throw cause;
	}
}
