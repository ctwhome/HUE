import { expect, test } from 'bun:test';
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
