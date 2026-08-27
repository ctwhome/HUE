import { expect, test } from 'bun:test';
import { ACCESS_COOKIE, createAccessSession } from './access-auth';
import { localApiAllowed } from './local-api';

test('allows only loopback clients with a loopback Host and same origin', () => {
	const localUrl = new URL('http://127.0.0.1/api/projects');
	const local = new Request(localUrl, { headers: { host: localUrl.host } });
	const reboundUrl = new URL('http://attacker.example/api/projects');
	const rebound = new Request(reboundUrl, {
		headers: { host: reboundUrl.host, origin: reboundUrl.origin }
	});

	expect(localApiAllowed(local, localUrl, '127.0.0.1')).toBe(true);
	expect(localApiAllowed(local, localUrl, '203.0.113.10')).toBe(false);
	expect(localApiAllowed(local, localUrl, undefined)).toBe(false);
	expect(localApiAllowed(rebound, reboundUrl, '127.0.0.1')).toBe(false);
	expect(
		localApiAllowed(
			new Request(localUrl, {
				headers: { host: localUrl.host, origin: 'https://attacker.example' }
			}),
			localUrl,
			'127.0.0.1'
		)
	).toBe(false);
	expect(
		localApiAllowed(
			new Request(localUrl, { headers: { host: '127.0.0.1.attacker.example' } }),
			localUrl,
			'127.0.0.1'
		)
	).toBe(false);
});

test('requires an authenticated session through a local Tailscale Serve proxy', () => {
	const url = new URL('https://m3-max.tail33436f.ts.net:4010/api/projects');
	const unauthenticated = new Request(url, {
		headers: { host: url.host, origin: url.origin }
	});
	const secret = 'configured-secret';
	const authenticated = new Request(url, {
		headers: {
			host: url.host,
			origin: url.origin,
			cookie: `${ACCESS_COOKIE}=${createAccessSession(secret)}`
		}
	});

	expect(localApiAllowed(unauthenticated, url, '127.0.0.1', secret)).toBe(false);
	expect(localApiAllowed(authenticated, url, '127.0.0.1', secret)).toBe(true);
	expect(localApiAllowed(authenticated, url, '203.0.113.10', secret)).toBe(true);
});
