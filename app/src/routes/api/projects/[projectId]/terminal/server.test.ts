import { expect, test } from 'bun:test';
import { _terminalAllowed } from './+server';

test('terminal access uses the client address instead of a spoofable host header', () => {
	const url = new URL('http://localhost/api/projects/project-1/terminal');
	const spoofed = new Request(url, {
		method: 'POST',
		headers: { host: 'localhost', origin: url.origin }
	});

	expect(_terminalAllowed(spoofed, url, '203.0.113.10', true)).toBe(false);
	expect(_terminalAllowed(spoofed, url, '127.0.0.1', true)).toBe(true);
});

test('terminal mutations require a same-origin browser request', () => {
	const url = new URL('http://localhost/api/projects/project-1/terminal');

	expect(_terminalAllowed(new Request(url, { method: 'POST' }), url, '127.0.0.1', true)).toBe(
		false
	);
	expect(
		_terminalAllowed(
			new Request(url, { method: 'POST', headers: { origin: 'https://example.test' } }),
			url,
			'127.0.0.1',
			true
		)
	).toBe(false);
});

test('terminal access rejects DNS rebinding hosts', () => {
	const url = new URL('http://attacker.example/api/projects/project-1/terminal');
	const request = new Request(url, {
		method: 'POST',
		headers: { host: 'attacker.example', origin: url.origin }
	});

	expect(_terminalAllowed(request, url, '127.0.0.1', true)).toBe(false);
});
