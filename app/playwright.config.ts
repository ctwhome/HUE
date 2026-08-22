import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.HUE_E2E_PORT ?? 4173);

export default defineConfig({
	webServer: {
		command: 'bun run build && bun build/index.js',
		port,
		env: {
			HUE_DATABASE_PATH: ':memory:',
			HERMES_HOME: join(tmpdir(), 'hue-playwright-hermes'),
			HOST: '127.0.0.1',
			PORT: String(port)
		}
	},
	use: { baseURL: `http://127.0.0.1:${port}` },
	testMatch: '**/*.e2e.{ts,js}'
});
