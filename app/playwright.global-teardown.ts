import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';

export default function cleanupHermesE2EHome() {
	const target = process.env.HUE_E2E_HERMES_HOME;
	if (!target) return;
	if (dirname(target) !== tmpdir() || !basename(target).startsWith('hue-playwright-hermes-')) {
		throw new Error('Refusing to remove an unexpected Hermes E2E home');
	}
	rmSync(target, { recursive: true, force: true });
}
