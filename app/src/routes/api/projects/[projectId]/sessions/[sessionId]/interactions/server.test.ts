import { expect, mock, test } from 'bun:test';

let resolvable = false;

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: { hasSession: () => true },
		dispatcher: { resolveInteraction: () => resolvable }
	})
}));

test('returns 409 when restart replay leaves no actionable interaction', async () => {
	resolvable = false;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'hue', sessionId: 'session-1' },
		request: new Request('http://localhost/interactions', {
			method: 'POST',
			body: JSON.stringify({
				interactionId: 'permission-1',
				response: { kind: 'permission', optionId: 'allow_once' }
			})
		})
	} as never);

	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		error: 'Interaction is unavailable or response is invalid'
	});
});

test('returns 400 for malformed JSON instead of throwing', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'hue', sessionId: 'session-1' },
		request: new Request('http://localhost/interactions', {
			method: 'POST',
			body: '{'
		})
	} as never);

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid interaction response' });
});
