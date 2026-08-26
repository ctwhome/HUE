import { expect, mock, test } from 'bun:test';

const calls: unknown[][] = [];

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: {
			findSessions: (...args: unknown[]) => {
				calls.push(args);
				return [{ sessionId: 'session-1', projectId: null, title: 'Result' }];
			}
		}
	})
}));

test('GET searches the HUE store without consulting Hermes', async () => {
	calls.length = 0;
	const { GET } = await import('./+server');
	const response = await GET({
		url: new URL('http://hue.test/api/sessions/search?q=release&status=waiting')
	} as never);

	expect(response.status).toBe(200);
	expect(calls).toEqual([['release', 'waiting', 50]]);
	expect(await response.json()).toEqual({
		results: [{ sessionId: 'session-1', projectId: null, title: 'Result' }]
	});
});

test('GET rejects unknown status filters', async () => {
	const { GET } = await import('./+server');
	const response = await GET({
		url: new URL('http://hue.test/api/sessions/search?status=completed')
	} as never);

	expect(response.status).toBe(400);
});
