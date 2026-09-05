import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeACP, isolatedOpenCodeEnvironment, openCodeChildEnvironment } from './opencode-acp';

it('passes OpenCode configuration without leaking HUE server state', () => {
	expect(
		openCodeChildEnvironment({
			PATH: '/usr/bin',
			HOME: '/home/test',
			XDG_CONFIG_HOME: '/config',
			OPENCODE_DISABLE_AUTOUPDATE: '1',
			ANTHROPIC_API_KEY: 'provider-key',
			HUE_DATABASE_PATH: '/private/hue.db',
			UNRELATED_SECRET: 'must-not-leak'
		})
	).toEqual({
		PATH: '/usr/bin',
		HOME: '/home/test',
		XDG_CONFIG_HOME: '/config',
		OPENCODE_DISABLE_AUTOUPDATE: '1',
		ANTHROPIC_API_KEY: 'provider-key'
	});
});

it('isolates the OpenCode smoke test from private credentials and state', () => {
	expect(
		isolatedOpenCodeEnvironment(
			{
				PATH: '/usr/bin:/bin',
				ANTHROPIC_API_KEY: 'must-not-leak',
				OPENCODE_CONFIG_DIR: '/private/opencode'
			},
			'/tmp/hue-opencode-isolated'
		)
	).toEqual({
		PATH: '/usr/bin:/bin',
		HOME: '/tmp/hue-opencode-isolated',
		XDG_CONFIG_HOME: '/tmp/hue-opencode-isolated/config',
		XDG_DATA_HOME: '/tmp/hue-opencode-isolated/data',
		XDG_CACHE_HOME: '/tmp/hue-opencode-isolated/cache',
		OPENCODE_DISABLE_AUTOUPDATE: '1',
		OPENCODE_DISABLE_MODELS_FETCH: '1'
	});
});

const realOpenCodeTest = process.env.HUE_REAL_OPENCODE === '1' ? it : it.skip;

realOpenCodeTest(
	'creates, lists, loads, and replays an isolated OpenCode ACP Session without a provider call',
	async () => {
		const home = mkdtempSync(join(tmpdir(), 'hue-real-opencode-'));
		const cwd = join(home, 'workspace');
		mkdirSync(cwd);
		const runtime = new OpenCodeACP({ env: isolatedOpenCodeEnvironment(process.env, home) });
		try {
			await runtime.start();
			expect(runtime.getRuntimeInfo()).toMatchObject({
				agent: { name: 'OpenCode', version: expect.any(String) }
			});
			const session = await runtime.createSession(cwd);
			expect((await runtime.listSessions(cwd)).map(({ sessionId }) => sessionId)).toContain(
				session.sessionId
			);
			expect(await runtime.loadTranscript(cwd, session.sessionId)).toEqual([]);
		} finally {
			await runtime.close();
			rmSync(home, { recursive: true, force: true });
		}
	},
	30_000
);
