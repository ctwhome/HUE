import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../../');
const makefile = readFileSync(resolve(root, 'Makefile'), 'utf8');
const devStack = readFileSync(resolve(root, 'scripts/dev-stack.sh'), 'utf8');

test('make dev explicitly loads app env when present', () => {
	expect(devStack).toContain('bun --env-file=.env --bun vite dev');
});

test('make dev hands the canonical database between production and development', () => {
	expect(makefile).not.toContain('hue-dev.db');
	expect(makefile).toContain('HUE_DATABASE_PATH="$(HUE_DATABASE_PATH)"');
	expect(devStack).toContain('launchctl bootout');
	expect(devStack).toContain('trap cleanup');
});

test('make dev opens desktop while web-dev keeps the browser-only server', () => {
	expect(makefile).toContain('./scripts/dev-stack.sh desktop');
	expect(makefile).toContain('./scripts/dev-stack.sh web');
	expect(makefile).toContain('desktop: install\n\tHUE_DESKTOP_ORIGIN=http://127.0.0.1:44010 bun run --cwd desktop dev');
});

test('make stop-production unloads KeepAlive before stopping serve processes', () => {
	const target = makefile.slice(
		makefile.indexOf('stop-production:'),
		makefile.indexOf('\nstop:', makefile.indexOf('stop-production:'))
	);

	expect(target).toContain('launchctl bootout');
	expect(target).toContain('./scripts/stop-services.sh serve');
	expect(target.indexOf('launchctl bootout')).toBeLessThan(
		target.indexOf('./scripts/stop-services.sh serve')
	);
});
