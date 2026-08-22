import { describe, expect, it } from 'bun:test';
import { redactHermesValue, redactPersistedValue } from './redaction';

for (const [name, redact] of [
	['redactHermesValue', redactHermesValue],
	['redactPersistedValue', redactPersistedValue]
] as const) {
	describe(name, () => {
		it('redacts secret semantic key parts across naming conventions and suffixes', () => {
			expect(
				redact({
					tokenValue: 'camel-token',
					token_value: 'snake-token',
					'token-value': 'kebab-token',
					passwordHash: 'password-hash',
					clientSecretValue: 'client-secret',
					credentialId: 'credential-id'
				})
			).toEqual({
				tokenValue: '[REDACTED]',
				token_value: '[REDACTED]',
				'token-value': '[REDACTED]',
				passwordHash: '[REDACTED]',
				clientSecretValue: '[REDACTED]',
				credentialId: '[REDACTED]'
			});
		});

		it('preserves safe words containing secret-like substrings', () => {
			const safe = {
				tokenizerValue: 'keep tokenizer',
				tokenCount: 42,
				passwordlessMode: 'keep passwordless',
				secretariatName: 'keep secretariat',
				credentialingStatus: 'keep credentialing',
				'x-cookie-policy': 'keep cookie policy'
			};

			expect(redact(safe)).toEqual(safe);
		});
	});
}

describe('redactPersistedValue', () => {
	it('redacts structured set-cookie keys while preserving safe header names', () => {
		const redacted = redactPersistedValue({
			'set-cookie': 'session=dash-secret',
			set_cookie: 'session=underscore-secret',
			'SeT-CoOkIe': 'session=case-secret',
			'content-type': 'application/json',
			'x-cookie-policy': 'documented'
		});

		expect(redacted).toEqual({
			'set-cookie': '[REDACTED]',
			set_cookie: '[REDACTED]',
			'SeT-CoOkIe': '[REDACTED]',
			'content-type': 'application/json',
			'x-cookie-policy': 'documented'
		});
	});

	it('redacts header values, JSON credentials, and complete private-key blocks recursively', () => {
		const privateKey = [
			'-----BEGIN PRIVATE KEY-----',
			'line-one-secret',
			'line-two-secret',
			'-----END PRIVATE KEY-----'
		].join('\n');
		const value = {
			title: 'Request failed with Set-Cookie: session=title-secret; HttpOnly',
			args: {
				headers: ['Cookie: session=cookie-secret; theme=dark', 'Accept: application/json'],
				body: JSON.stringify({
					apiKey: 'api-secret',
					access_token: 'access-secret',
					clientSecret: 'client-secret',
					password: 'password-secret',
					safe: { enabled: true, label: 'keep me' }
				})
			},
			result: `Generated key:\n${privateKey}\nSafe suffix`,
			error: `Authentication failed\n${privateKey}`,
			children: [{ goal: 'Inspect safely', result: 'Set-Cookie=session=child-secret; Secure' }],
			safe: { count: 2, enabled: true, text: 'Cookie handling stays documented.' }
		};

		const redacted = redactPersistedValue(value) as typeof value;
		const serialized = JSON.stringify(redacted);

		for (const secret of [
			'title-secret',
			'cookie-secret',
			'api-secret',
			'access-secret',
			'client-secret',
			'password-secret',
			'line-one-secret',
			'line-two-secret',
			'child-secret'
		]) {
			expect(serialized).not.toContain(secret);
		}
		expect(redacted).toMatchObject({
			args: {
				headers: ['Cookie: [REDACTED]', 'Accept: application/json']
			},
			children: [{ goal: 'Inspect safely', result: 'Set-Cookie=[REDACTED]' }],
			safe: { count: 2, enabled: true, text: 'Cookie handling stays documented.' }
		});
		expect(JSON.parse(redacted.args.body)).toEqual({
			apiKey: '[REDACTED]',
			access_token: '[REDACTED]',
			clientSecret: '[REDACTED]',
			password: '[REDACTED]',
			safe: { enabled: true, label: 'keep me' }
		});
		expect(redacted.result).toBe('Generated key:\n[REDACTED]\nSafe suffix');
		expect(redacted.error).toBe('Authentication failed\n[REDACTED]');
	});
});
