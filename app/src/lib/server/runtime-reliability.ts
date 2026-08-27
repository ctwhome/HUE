import type { HermesRuntimeInfo } from './hermes-acp';
import { HermesAdmin } from './hermes-admin';
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
	database: { status: 'ready' | 'unavailable'; integrity?: 'ok'; action?: string };
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
