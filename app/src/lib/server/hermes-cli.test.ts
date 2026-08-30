import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHermesCommand } from './hermes-cli';

test('resolves a user-local Hermes install when it is outside PATH', () => {
	const home = mkdtempSync(join(tmpdir(), 'hue-hermes-command-'));
	const command = join(home, '.local', 'bin', 'hermes');
	mkdirSync(join(home, '.local', 'bin'), { recursive: true });
	writeFileSync(command, '#!/bin/sh\n');
	chmodSync(command, 0o755);

	expect(resolveHermesCommand({}, home)).toBe(command);
});

test('production code has no direct hermes chat or mutable Hermes cron API path', () => {
	for (const path of new Bun.Glob('app/src/**/*.{ts,svelte}').scanSync('.')) {
		if (path.endsWith('.test.ts') || path.endsWith('.e2e.ts')) continue;
		const source = readFileSync(path, 'utf8');
		if (path.endsWith('external-hermes-cron.ts')) {
			expect(source).toContain("'/api/cron/jobs?profile=all'");
			expect(source).not.toContain('/trigger');
			expect(source).not.toContain('/fire');
			continue;
		}
		expect(source).not.toContain('/api/cron');
	}
	const cli = readFileSync('app/src/lib/server/hermes-cli.ts', 'utf8');
	expect(cli).not.toContain("'chat'");
	expect(cli).not.toContain('Bun.spawn');
});
