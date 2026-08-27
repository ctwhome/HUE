import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('make dev explicitly loads app env when present', () => {
	const makefile = readFileSync(resolve(import.meta.dir, '../../../../Makefile'), 'utf8');

	expect(makefile).toContain('bun --env-file=.env --bun vite dev');
});
