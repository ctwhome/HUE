import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const port = Number(process.env.HUE_E2E_PORT ?? 4173);
const testHome = mkdtempSync(join(tmpdir(), 'hue-playwright-home-'));
const hermesHome = join(testHome, '.hermes');
mkdirSync(hermesHome);
process.env.HUE_E2E_HERMES_HOME = hermesHome;
process.once('exit', () => {
	if (dirname(testHome) !== tmpdir() || !basename(testHome).startsWith('hue-playwright-home-')) {
		return;
	}
	rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

export default defineConfig({
	workers: 1,
	webServer: {
		command: 'bun run build && bun run start',
		port,
		timeout: 180_000,
		env: {
			PATH: process.env.PATH ?? '',
			HOME: testHome,
			SHELL: process.env.SHELL ?? '/bin/sh',
			TMPDIR: process.env.TMPDIR ?? tmpdir(),
			HUE_DATABASE_PATH: ':memory:',
			HERMES_HOME: hermesHome,
			OPENAI_API_KEY: 'hue-e2e-invalid',
			AWS_ACCESS_KEY_ID: 'hue-e2e-invalid',
			AWS_SECRET_ACCESS_KEY: 'hue-e2e-invalid',
			HTTP_PROXY: 'http://127.0.0.1:9',
			HTTPS_PROXY: 'http://127.0.0.1:9',
			ALL_PROXY: 'http://127.0.0.1:9',
			NO_PROXY: '127.0.0.1,localhost',
			BODY_SIZE_LIMIT: '2000000',
			HOST: '127.0.0.1',
			ORIGIN: `http://127.0.0.1:${port}`,
			PORT: String(port)
		}
	},
	use: { baseURL: `http://127.0.0.1:${port}` },
	testMatch: '**/*.e2e.{ts,js}'
});
