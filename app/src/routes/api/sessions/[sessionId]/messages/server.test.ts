import { expect, mock, test } from 'bun:test';

let submitResult: Record<string, unknown> = { duplicate: false, status: 'queued', workMode: 'live' };

mock.module('$lib/server/services', () => ({
	services: () => ({
		store: {
			hasSession: () => true,
			getSession: () => ({ workMode: 'autonomous' }),
			updateSessionWorkMode: (_projectId: null, _sessionId: string, workMode: string) => ({
				session: { workMode },
				event: {
					sequence: 1,
					type: 'session.work_mode_changed',
					payload: { workMode }
				}
			})
		},
		dispatcher: {
			submit: () => submitResult
		}
	})
}));

test('projectless message acceptance returns effective work mode after natural-language switch', async () => {
	submitResult = { duplicate: false, status: 'queued', workMode: 'live' };
	const { POST } = await import('./+server');
	const response = await POST({
		params: { sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ messageId: 'message', text: "I'm at the computer" })
		})
	} as never);

	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({ messageId: 'message', workMode: 'live' });
});
