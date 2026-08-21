import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'bun run build && bun build/index.js',
		port: 4173,
		env: { HUE_DATABASE_PATH: ':memory:', HOST: '127.0.0.1', PORT: '4173' }
	},
	use: { baseURL: 'http://127.0.0.1:4173' },
	testMatch: '**/*.e2e.{ts,js}'
});
