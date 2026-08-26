import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
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
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.createWorkflow({
			id: 'release',
			projectId: 'hue',
			name: 'Release',
			prompt: 'Run checks.'
		});

		const backup = createHueBackup(store, join(root, 'backups'));

		expect(backup.validated).toBe(true);
		expect(backup.filename).toMatch(/^hue-\d{4}-\d{2}-\d{2}T.*\.sqlite$/);
		expect(validateHueBackup(backup.path)).toEqual({ ok: true });
		const restored = new Database(backup.path, { readonly: true });
		expect(restored.query('SELECT name FROM projects WHERE id = ?').get('hue')).toEqual({
			name: 'HUE'
		});
		expect(restored.query('SELECT name FROM workflows WHERE id = ?').get('release')).toEqual({
			name: 'Release'
		});
		restored.close();
		store.close();
	});

	it('does not validate a corrupt backup artifact', () => {
		const path = join(tmpdir(), `hue-corrupt-${crypto.randomUUID()}.sqlite`);
		paths.push(path);
		writeFileSync(path, 'not sqlite', { mode: 0o600 });
		chmodSync(path, 0o600);

		expect(validateHueBackup(path).ok).toBe(false);
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
					capabilities: { loadSession: true }
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
			capabilities: { loadSession: true }
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
