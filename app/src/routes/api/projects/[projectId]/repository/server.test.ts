import { expect, test } from 'bun:test';
import { _repositoryMutationAllowed } from './+server';

test('repository mutations require a loopback same-origin request', () => {
	const localUrl = new URL('http://127.0.0.1/api/projects/project-1/repository');
	const local = new Request(localUrl, {
		method: 'POST',
		headers: { host: '127.0.0.1', origin: localUrl.origin }
	});
	const reboundUrl = new URL('http://attacker.example/api/projects/project-1/repository');
	const rebound = new Request(reboundUrl, {
		method: 'POST',
		headers: { host: 'attacker.example', origin: reboundUrl.origin }
	});

	expect(_repositoryMutationAllowed(local, '127.0.0.1')).toBe(true);
	expect(_repositoryMutationAllowed(local, '203.0.113.10')).toBe(false);
	expect(_repositoryMutationAllowed(rebound, '127.0.0.1')).toBe(false);
});
