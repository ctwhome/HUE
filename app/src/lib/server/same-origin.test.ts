import { expect, test } from 'bun:test';
import { localSameOriginMutationAllowed, sameOriginMutationAllowed } from './same-origin';

test('allows an HTTPS browser origin terminated at a same-host HTTP proxy', () => {
	const request = new Request('http://hue.example.test/login', {
		headers: { host: 'hue.example.test', origin: 'https://hue.example.test' }
	});

	expect(sameOriginMutationAllowed(request, new URL(request.url))).toBe(true);
});

test('rejects cross-host and HTTPS-to-HTTP downgrade origins', () => {
	const url = new URL('https://hue.example.test/login');

	expect(
		sameOriginMutationAllowed(
			new Request(url, { headers: { host: url.host, origin: 'https://evil.test' } }),
			url
		)
	).toBe(false);
	expect(
		sameOriginMutationAllowed(
			new Request(url, { headers: { host: url.host, origin: 'http://hue.example.test' } }),
			url
		)
	).toBe(false);
});

test('local mutations require direct loopback and same origin', () => {
	const url = new URL('http://localhost/api/media');
	const request = new Request(url, { headers: { host: url.host, origin: url.origin } });
	expect(localSameOriginMutationAllowed(request, url, '127.0.0.1')).toBe(true);
	expect(localSameOriginMutationAllowed(request, url, '203.0.113.10')).toBe(false);
	expect(
		localSameOriginMutationAllowed(
			new Request(url, {
				headers: { host: url.host, origin: url.origin, 'x-forwarded-for': '127.0.0.1' }
			}),
			url,
			'127.0.0.1'
		)
	).toBe(false);
});
