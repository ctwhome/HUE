import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Database as BunDatabase } from 'bun:sqlite';

const runtimeRequire = createRequire(import.meta.url);
export const HUE_SCHEMA_VERSION = 3;

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
		'work_mode',
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
	message_attachments: ['message_id', 'position', 'name', 'mime_type', 'data', 'size'],
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
	notification_presence: ['endpoint_id', 'project_id', 'session_id', 'visible', 'expires_at']
} as const;

type SchemaManifest = { version: number; tables: Record<string, string[]> };

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
		if (
			integrity?.quick_check !== 'ok' ||
			database.query('PRAGMA foreign_key_check').all().length ||
			!validSchema
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
	writeFileSync(path, database.serialize(), { flag: 'wx', mode: 0o600 });
	chmodSync(path, 0o600);
	const validation = validateHueBackup(path, sourceManifest);
	if (!validation.ok) {
		rmSync(path, { force: true });
		throw new Error(validation.error);
	}
	return { filename, path, validated: true as const };
}
