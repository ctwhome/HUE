import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { HermesACP } from './hermes-acp';
import { MessageDispatcher } from './message-dispatcher';
import { HUEStore } from './store';

type HUEServices = {
	store: HUEStore;
	runtime: HermesACP;
	dispatcher: MessageDispatcher;
};

const globalServices = globalThis as typeof globalThis & {
	__hueServices?: HUEServices;
};

function createServices(): HUEServices {
	const databasePath = process.env.HUE_DATABASE_PATH ?? join(homedir(), '.hue', 'hue.db');
	if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
	const store = new HUEStore(databasePath);
	const runtime = new HermesACP({
		profile: process.env.HUE_HERMES_PROFILE ?? 'default',
		onDiagnostic: (message) => console.error(`[hermes-acp] ${message}`)
	});
	return { store, runtime, dispatcher: new MessageDispatcher(store, runtime) };
}

export function services(): HUEServices {
	globalServices.__hueServices ??= createServices();
	return globalServices.__hueServices;
}

export function trustedProjectRoot(input: string): string {
	const candidate = input.trim();
	if (!candidate || !isAbsolute(candidate)) {
		throw new Error('Project root must be an absolute path');
	}
	const canonical = resolve(candidate);
	let stat;
	try {
		stat = statSync(canonical);
	} catch {
		throw new Error('Project root does not exist');
	}
	if (!stat.isDirectory()) throw new Error('Project root must be a directory');
	return realpathSync(canonical);
}

export function sessionMatchesProjectRoot(projectRoot: string, sessionCwd: string): boolean {
	try {
		return realpathSync(projectRoot) === realpathSync(sessionCwd);
	} catch {
		return false;
	}
}
