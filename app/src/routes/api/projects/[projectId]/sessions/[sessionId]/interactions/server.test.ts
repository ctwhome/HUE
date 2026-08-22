import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let resolvable = false;
const projectIds: string[] = [];

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'canonical-project' }),
	services: () => ({
		store: {
			hasSession: (projectId: string) => {
				projectIds.push(projectId);
				return true;
			}
		},
		dispatcher: {
			resolveInteraction: (projectId: string) => {
				projectIds.push(projectId);
				return resolvable;
			}
		}
	})
}));

test('returns 409 when restart replay leaves no actionable interaction', async () => {
	resolvable = false;
	projectIds.length = 0;
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
	expect(projectIds).toEqual(['canonical-project', 'canonical-project']);
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
