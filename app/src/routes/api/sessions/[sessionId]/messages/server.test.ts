import { expect, mock, test } from 'bun:test';

let submitResult: Record<string, unknown> = {
	duplicate: false,
	status: 'queued',
	workMode: 'live'
};
let submitted = false;
let runtimeStarted = false;

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
			submit: () => {
				submitted = true;
				return submitResult;
			}
		},
		runtime: {
			start: async () => {
				runtimeStarted = true;
			},
			getCapabilities: () => ({ promptImage: false })
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

test('projectless image rejection negotiates before dispatch persistence', async () => {
	submitted = false;
	runtimeStarted = false;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { sessionId: 'session-1' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({
				messageId: 'image-message',
				text: 'Inspect',
				images: [
					{
						name: 'screen.png',
						mimeType: 'image/png',
						data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
					}
				]
			})
		})
	} as never);

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Hermes does not support image prompts' });
	expect(runtimeStarted).toBe(true);
	expect(submitted).toBe(false);
});
