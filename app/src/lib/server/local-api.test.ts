import { expect, test } from 'bun:test';
import { localApiAllowed } from './local-api';

test('allows local API clients and rejects remote or rebound requests', () => {
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
});
