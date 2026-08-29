import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveHermesCommand(
	env: Record<string, string | undefined> = process.env,
	home = homedir()
) {
	if (env.HUE_HERMES_COMMAND?.trim()) return env.HUE_HERMES_COMMAND.trim();
	const localCommand = join(home, '.local', 'bin', 'hermes');
	try {
		accessSync(localCommand, constants.X_OK);
		return localCommand;
	} catch {
		return 'hermes';
	}
}
