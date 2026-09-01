import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('make dev explicitly loads app env when present', () => {
	const makefile = readFileSync(resolve(import.meta.dir, '../../../../Makefile'), 'utf8');

	expect(makefile).toContain('bun --env-file=.env --bun vite dev');
});

test('make dev hands the canonical database between production and development', () => {
	const makefile = readFileSync(resolve(import.meta.dir, '../../../../Makefile'), 'utf8');

	expect(makefile).not.toContain('hue-dev.db');
	expect(makefile).toContain('launchctl bootout');
	expect(makefile).toContain('HUE_DATABASE_PATH="$(HUE_DATABASE_PATH)"');
	expect(makefile).toContain("trap 'launchctl bootstrap");
});
