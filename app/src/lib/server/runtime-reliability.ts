import type { HermesRuntimeInfo } from './hermes-acp';
import { createHueDatabaseBackup } from './hue-backup';
import type { HUEStore } from './store';

export { validateHueBackup } from './hue-backup';

type RuntimeStatus = 'idle' | 'ready' | 'unavailable';

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
	database: { status: 'ready' | 'unavailable'; action?: string };
	acp: { status: RuntimeStatus } & HermesRuntimeInfo;
	admin: {
		status: RuntimeStatus;
		version?: string;
		capabilities?: Record<string, unknown>;
		action?: string;
	};
};

export function createHueBackup(store: HUEStore, backupDirectory?: string) {
	return createHueDatabaseBackup(store.database, store.filename, backupDirectory);
}

export async function runtimeDiagnostics(state: RuntimeServices): Promise<RuntimeDiagnostics> {
	let databaseReady = false;
	try {
		databaseReady = !!state.store.database.query('SELECT 1').get();
	} catch {
		// The actionable unavailable state below is safer than leaking SQLite or filesystem details.
	}
	const info = state.runtime.getRuntimeInfo();
	const diagnostics: RuntimeDiagnostics = {
		database: databaseReady
			? { status: 'ready' }
			: { status: 'unavailable', action: 'Stop HUE and restore a validated backup' },
		acp: { status: state.runtime.healthStatus(), ...info },
		admin: { status: state.admin.healthStatus() }
	};
	if (diagnostics.admin.status !== 'ready' || !state.admin.json) return diagnostics;
	try {
		const health = await state.admin.json<Record<string, unknown>>('/api/health');
		return {
			...diagnostics,
			admin: {
				status: 'ready',
				...(typeof health?.version === 'string' ? { version: health.version } : {}),
				capabilities: { logs: true, updateCheck: true, adminRestart: true, acpReconnect: true }
			}
		};
	} catch {
		return {
			...diagnostics,
			admin: { status: 'unavailable', action: 'Open Runtime and restart Hermes admin' }
		};
	}
}
