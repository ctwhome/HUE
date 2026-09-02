import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HUEStore } from './store';
import { createHueBackup, runtimeDiagnostics, validateHueBackup } from './runtime-reliability';

const paths: string[] = [];

afterEach(() => {
	for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe('HUE runtime reliability', () => {
	it('creates and validates a consistent backup of the HUE database', () => {
		const root = join(tmpdir(), `hue-backup-${crypto.randomUUID()}`);
		const source = join(root, 'hue.db');
		paths.push(root);
		const store = new HUEStore(source);
		store.database.exec('PRAGMA journal_mode = WAL');
		store.ensureProjectMetadata('hue', 'HUE');
		store.createWorkflow({
			id: 'release',
			projectId: 'hue',
			name: 'Release',
			prompt: 'Run checks.'
		});
		store.upsertSession(null, { sessionId: 'schedule-session', cwd: '/work/sessions' });
		store.acceptMessage({
			id: 'message-with-image',
			projectId: null,
			sessionId: 'schedule-session',
			text: 'Preserve this image.',
			images: [{ name: 'proof.png', mimeType: 'image/png', data: 'aGVsbG8=' }]
		});
		store.createSchedule({
			id: 'daily',
			name: 'Daily review',
			prompt: 'Review HUE.',
			cron: '0 9 * * *',
			enabled: true,
			nextRunAt: '2026-08-29T09:00:00.000Z',
			sessionId: 'schedule-session'
		});

		const backup = createHueBackup(store, join(root, 'backups'));

		expect(backup.validated).toBe(true);
		expect(backup.attachmentsPath).toBe(`${backup.path}.attachments`);
		expect(backup.filename).toMatch(/^hue-\d{4}-\d{2}-\d{2}T.*\.sqlite$/);
		expect(validateHueBackup(backup.path)).toEqual({ ok: true });
		const restored = new Database(backup.path, { readonly: true });
		expect(restored.query('SELECT name FROM projects WHERE id = ?').get('hue')).toEqual({
			name: 'HUE'
		});
		expect(restored.query('SELECT name FROM workflows WHERE id = ?').get('release')).toEqual({
			name: 'Release'
		});
		const attachment = restored
			.query('SELECT file_path FROM message_attachments WHERE message_id = ?')
			.get('message-with-image') as { file_path: string };
		expect(readFileSync(join(`${backup.path}.attachments`, attachment.file_path)).toString()).toBe(
			'hello'
		);
		expect(
			restored.query('SELECT name, session_id FROM schedules WHERE id = ?').get('daily')
		).toEqual({
			name: 'Daily review',
			session_id: 'schedule-session'
		});
		restored.close();
		rmSync(join(`${backup.path}.attachments`, attachment.file_path));
		expect(validateHueBackup(backup.path).ok).toBe(false);
		store.close();
	});

	it('does not validate a corrupt backup artifact', () => {
		const path = join(tmpdir(), `hue-corrupt-${crypto.randomUUID()}.sqlite`);
		paths.push(path);
		writeFileSync(path, 'not sqlite', { mode: 0o600 });
		chmodSync(path, 0o600);

		expect(validateHueBackup(path).ok).toBe(false);
	});

	it('rejects a readable two-table database as an incomplete HUE backup', () => {
		const path = join(tmpdir(), `hue-incomplete-${crypto.randomUUID()}.sqlite`);
		paths.push(path);
		const database = new Database(path, { create: true, strict: true });
		database.exec(`
			CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL);
			CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL);
			PRAGMA user_version = 1;
		`);
		database.close();

		expect(validateHueBackup(path)).toEqual({
			ok: false,
			error: 'Backup failed HUE database validation'
		});
	});

	it('reports only runtime facts exposed by existing services', async () => {
		const store = new HUEStore(':memory:');
		const diagnostics = await runtimeDiagnostics({
			store,
			runtime: {
				healthStatus: () => 'ready',
				getRuntimeInfo: () => ({
					profile: 'default',
					protocolVersion: 1,
					agent: { name: 'hermes-agent', version: '0.20.5' },
					capabilities: {
						loadSession: true,
						promptImage: false,
						sessionList: true,
						sessionFork: false,
						sessionResume: false,
						commands: []
					}
				})
			},
			admin: {
				healthStatus: () => 'idle'
			}
		});

		expect(diagnostics.database).toEqual({ status: 'ready', integrity: 'ok' });
		expect(diagnostics.acp).toMatchObject({
			status: 'ready',
			protocolVersion: 1,
			agent: { name: 'hermes-agent', version: '0.20.5' },
			capabilities: {
				loadSession: true,
				promptImage: false,
				sessionList: true,
				sessionFork: false,
				sessionResume: false,
				commands: []
			}
		});
		expect(diagnostics.admin).toEqual({ status: 'idle' });
		expect(diagnostics.admin).not.toHaveProperty('version');
		expect(diagnostics.admin).not.toHaveProperty('capabilities');
		store.close();
	});

	it('turns a failed HUE integrity check into actionable diagnostics', async () => {
		const diagnostics = await runtimeDiagnostics({
			store: {
				database: {
					query: () => ({
						get: () => {
							throw new Error('disk I/O error');
						}
					})
				}
			} as never,
			runtime: {
				healthStatus: () => 'idle',
				getRuntimeInfo: () => ({ profile: 'default' })
			},
			admin: { healthStatus: () => 'idle' }
		});

		expect(diagnostics.database).toEqual({
			status: 'unavailable',
			action: 'Stop HUE and restore a validated backup'
		});
	});

	it('reports Hermes admin version and capabilities only after successful readback', async () => {
		const store = new HUEStore(':memory:');
		const diagnostics = await runtimeDiagnostics({
			store,
			runtime: {
				healthStatus: () => 'idle',
				getRuntimeInfo: () => ({ profile: 'default' })
			},
			admin: {
				healthStatus: () => 'ready',
				json: async <T>(path: string) => (path === '/api/health' ? { version: '0.20.5' } : {}) as T
			}
		});

		expect(diagnostics.admin).toEqual({
			status: 'ready',
			version: '0.20.5',
			capabilities: { logs: true, updateCheck: true, adminRestart: true, acpReconnect: true }
		});
		store.close();
	});
});
