import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Database as BunDatabase } from 'bun:sqlite';
import type { HermesRuntimeInfo } from './hermes-acp';
import { HermesAdmin } from './hermes-admin';
import type { HUEStore } from './store';

type RuntimeStatus = 'idle' | 'ready' | 'unavailable';
const runtimeRequire = createRequire(import.meta.url);

type RuntimeServices = {
	store: HUEStore;
	runtime: {
		healthStatus(): RuntimeStatus;
		getRuntimeInfo(): HermesRuntimeInfo;
	};
	admin: {
		healthStatus(): RuntimeStatus;
		json?<T>(path: string): Promise<T>;
	};
};

export type RuntimeDiagnostics = {
	database: { status: 'ready' | 'unavailable'; integrity?: 'ok'; action?: string };
	acp: { status: RuntimeStatus } & HermesRuntimeInfo;
	admin: {
		status: RuntimeStatus;
		version?: string;
		capabilities?: Record<string, unknown>;
		action?: string;
	};
};

export function validateHueBackup(path: string): { ok: boolean; error?: string } {
	let database: BunDatabase | undefined;
	try {
		const { Database } = runtimeRequire('bun:sqlite') as typeof import('bun:sqlite');
		database = new Database(path, { readonly: true, strict: true });
		const integrity = database.query<{ quick_check: string }, []>('PRAGMA quick_check').get();
		const tables = new Set(
			database
				.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map(({ name }) => name)
		);
		const required = ['projects', 'workflows', 'project_sessions', 'messages', 'session_events'];
		if (integrity?.quick_check !== 'ok' || required.some((table) => !tables.has(table))) {
			return { ok: false, error: 'Backup failed HUE database validation' };
		}
		return { ok: true };
	} catch {
		return { ok: false, error: 'Backup is not a readable SQLite database' };
	} finally {
		database?.close();
	}
}

export function createHueBackup(store: HUEStore, backupDirectory?: string) {
	if (store.filename === ':memory:') throw new Error('In-memory HUE databases cannot be backed up');
	const directory = backupDirectory ?? join(dirname(store.filename), 'backups');
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	const filename = `hue-${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}.sqlite`;
	const path = join(directory, filename);
	writeFileSync(path, store.database.serialize(), { flag: 'wx', mode: 0o600 });
	chmodSync(path, 0o600);
	const validation = validateHueBackup(path);
	if (!validation.ok) {
		rmSync(path, { force: true });
		throw new Error(validation.error);
	}
	return { filename, path, validated: true as const };
}

export async function runtimeDiagnostics(state: RuntimeServices): Promise<RuntimeDiagnostics> {
	let databaseIntegrity: string | undefined;
	try {
		databaseIntegrity = state.store.database
			.query<{ quick_check: string }, []>('PRAGMA quick_check')
			.get()?.quick_check;
	} catch {
		// The actionable unavailable state below is safer than leaking SQLite or filesystem details.
	}
	const info = state.runtime.getRuntimeInfo();
	const diagnostics: RuntimeDiagnostics = {
		database:
			databaseIntegrity === 'ok'
				? { status: 'ready', integrity: 'ok' }
				: { status: 'unavailable', action: 'Stop HUE and restore a validated backup' },
		acp: { status: state.runtime.healthStatus(), ...info },
		admin: { status: state.admin.healthStatus() }
	};
	if (diagnostics.admin.status !== 'ready' || !state.admin.json) return diagnostics;
	try {
		const runtime = await new HermesAdmin(state.admin as Required<RuntimeServices['admin']>).view(
			'runtime'
		);
		const health = runtime.health as Record<string, unknown> | undefined;
		return {
			...diagnostics,
			admin: {
				status: 'ready',
				...(typeof health?.version === 'string' ? { version: health.version } : {}),
				...(runtime.capabilities && typeof runtime.capabilities === 'object'
					? { capabilities: runtime.capabilities as Record<string, unknown> }
					: {})
			}
		};
	} catch {
		return {
			...diagnostics,
			admin: { status: 'unavailable', action: 'Open Runtime and restart Hermes admin' }
		};
	}
}
