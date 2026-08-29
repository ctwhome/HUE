import { expect, test } from 'bun:test';
import { hermesChildEnvironment } from './hermes-env';

test('Hermes child environment preserves runtime/provider values and strips HUE secrets', () => {
	expect(
		hermesChildEnvironment({
			PATH: '/bin',
			HOME: '/home/user',
			HERMES_HOME: '/private/hermes',
			OPENAI_API_KEY: 'provider',
			GITHUB_TOKEN: 'copilot',
			HUE_ACCESS_SECRET: 'control-plane',
			HUE_DATABASE_PATH: '/private/hue.db',
			UNRELATED_SECRET: 'nope'
		})
	).toEqual({
		PATH: '/bin',
		HOME: '/home/user',
		HERMES_HOME: '/private/hermes',
		OPENAI_API_KEY: 'provider',
		GITHUB_TOKEN: 'copilot'
	});
});

test('Hermes child environment preserves an explicit test network block', () => {
	expect(
		hermesChildEnvironment({
			HOME: '/tmp/hue-e2e-home',
			HTTP_PROXY: 'http://127.0.0.1:9',
			HTTPS_PROXY: 'http://127.0.0.1:9',
			ALL_PROXY: 'http://127.0.0.1:9'
		})
	).toEqual({
		HOME: '/tmp/hue-e2e-home',
		HTTP_PROXY: 'http://127.0.0.1:9',
		HTTPS_PROXY: 'http://127.0.0.1:9',
		ALL_PROXY: 'http://127.0.0.1:9'
	});
});
