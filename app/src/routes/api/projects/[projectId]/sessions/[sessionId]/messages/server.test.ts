import { expect, mock, test } from 'bun:test';

let submitted = false;
mock.module('$lib/server/services', () => ({
	services: () => ({
		store: { getProject: () => ({ id: 'project' }), hasSession: () => true },
		dispatcher: {
			submit: () => {
				submitted = true;
				return { duplicate: false, status: 'queued' };
			}
		}
	})
}));

test('rejects combined image and generic attachment count before dispatch', async () => {
	submitted = false;
	const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
	const text = Buffer.from('hello').toString('base64');
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({
				messageId: 'message',
				text: 'Review',
				images: Array.from({ length: 4 }, (_, index) => ({
					name: `${index}.png`,
					mimeType: 'image/png',
					data: png
				})),
				attachments: Array.from({ length: 5 }, (_, index) => ({
					name: `${index}.txt`,
					mimeType: 'text/plain',
					size: 5,
					data: text
				}))
			})
		})
	} as never);
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Attach no more than 8 files' });
	expect(submitted).toBe(false);
});
