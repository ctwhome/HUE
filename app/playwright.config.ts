import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.HUE_E2E_PORT ?? 4173);
const hermesHome = mkdtempSync(join(tmpdir(), 'hue-playwright-hermes-'));
process.env.HUE_E2E_HERMES_HOME = hermesHome;

export default defineConfig({
	globalTeardown: './playwright.global-teardown.ts',
	workers: 1,
	webServer: {
		command: 'bun run build && bun run start',
		port,
		env: {
			HUE_DATABASE_PATH: ':memory:',
			HERMES_HOME: hermesHome,
			BODY_SIZE_LIMIT: '2000000',
			HOST: '127.0.0.1',
			ORIGIN: `http://127.0.0.1:${port}`,
			PORT: String(port)
		}
	},
	use: { baseURL: `http://127.0.0.1:${port}` },
	testMatch: '**/*.e2e.{ts,js}'
});
