import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let submitted = false;
let envelope: Record<string, unknown> | null = null;
let submitResult: Record<string, unknown> = { duplicate: false, status: 'queued' };
let workModeUpdates = 0;
const metadataIds: string[] = [];
const sessionProjectIds: string[] = [];
const operationReferences: string[] = [];
let updatedEnvelope: Record<string, unknown> | null = null;
let runtimeStarted = false;
let negotiatedImageCapability = false;
mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'project' }),
	services: () => ({
		store: {
			ensureProjectMetadata: (id: string) => metadataIds.push(id),
			getSession: () => ({ workMode: 'autonomous' }),
			updateSessionWorkMode: (_projectId: string, _sessionId: string, workMode: string) => {
				workModeUpdates += 1;
				return {
					session: { workMode },
					event: {
						sequence: 1,
						type: 'session.work_mode_changed',
						payload: { workMode }
					}
				};
			},
			hasSession: (id: string) => {
				sessionProjectIds.push(id);
				return true;
			}
		},
		dispatcher: {
			submit: (input: Record<string, unknown>) => {
				submitted = true;
				envelope = input;
				return submitResult;
			},
			updateQueuedMessage: (_id: string, input: Record<string, unknown>) => {
				updatedEnvelope = input;
				return { id: 'message', ...input };
			}
		},
		projectOperations: {
			message: async (reference: string, operation: (project: { id: string }) => unknown) => {
				operationReferences.push(reference);
				return operation({ id: 'canonical-project' });
			}
		},
		runtime: {
			start: async () => {
				runtimeStarted = true;
			},
			getCapabilities: () => ({ promptImage: runtimeStarted && negotiatedImageCapability })
		}
	})
}));

test('persists Project-scoped message under canonical Hermes id', async () => {
	submitted = false;
	envelope = null;
	metadataIds.length = 0;
	sessionProjectIds.length = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project-slug', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ messageId: 'message', text: 'Run' })
		})
	} as never);

	expect(response.status).toBe(202);
	expect(await response.clone().json()).toMatchObject({ workModeChanged: false });
	expect(metadataIds).toEqual(['canonical-project']);
	expect(sessionProjectIds).toEqual(['canonical-project']);
	expect(envelope).toMatchObject({ projectId: 'canonical-project', sessionId: 'session' });
});

test('validates and submits structured review contexts', async () => {
	envelope = null;
	const { POST } = await import('./+server');
	const reviewContexts = [
		{
			id: 'review-1',
			source: 'assistant',
			label: 'Hermes response',
			content: 'Selected response text',
			comment: 'Revise this.'
		}
	];
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ messageId: 'message-review', text: 'Please update.', reviewContexts })
		})
	} as never);

	expect(response.status).toBe(202);
	expect(envelope).toMatchObject({ reviewContexts });
});

test('updates queued message under canonical Hermes id inside Project operation lock', async () => {
	updatedEnvelope = null;
	operationReferences.length = 0;
	sessionProjectIds.length = 0;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-slug', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'PATCH',
			body: JSON.stringify({ messageId: 'message', text: 'Updated' })
		})
	} as never);

	expect(response.status).toBe(200);
	expect(operationReferences).toEqual(['project-slug']);
	expect(sessionProjectIds).toEqual(['canonical-project']);
	expect(updatedEnvelope).toMatchObject({
		projectId: 'canonical-project',
		sessionId: 'session',
		text: 'Updated'
	});
});

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

test('rejects an unsupported image before HUE dispatch persistence', async () => {
	submitted = false;
	runtimeStarted = false;
	negotiatedImageCapability = false;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
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
	expect(submitted).toBe(false);
	expect(runtimeStarted).toBe(true);
});

test('accepts an image after cold-start capability negotiation', async () => {
	submitted = false;
	runtimeStarted = false;
	negotiatedImageCapability = true;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({
				messageId: 'supported-image',
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

	expect(response.status).toBe(202);
	expect(runtimeStarted).toBe(true);
	expect(submitted).toBe(true);
});

test('message acceptance returns effective work mode after natural-language switch', async () => {
	submitResult = { duplicate: false, status: 'queued', workMode: 'live' };
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({ messageId: 'message', text: "I'm at the computer" })
		})
	} as never);

	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({
		messageId: 'message',
		workMode: 'live',
		workModeChanged: true,
		workModeEvent: { type: 'session.work_mode_changed', payload: { workMode: 'live' } }
	});
});

test('rejects a local work mode alias with attachments instead of discarding content', async () => {
	submitted = false;
	workModeUpdates = 0;
	const { POST } = await import('./+server');
	const response = await POST({
		params: { projectId: 'project', sessionId: 'session' },
		request: new Request('http://hue.test', {
			method: 'POST',
			body: JSON.stringify({
				messageId: 'message-with-file',
				text: '/live-co-development',
				attachments: [
					{
						name: 'notes.txt',
						mimeType: 'text/plain',
						size: 5,
						data: Buffer.from('hello').toString('base64')
					}
				]
			})
		})
	} as never);

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Work mode commands cannot include attachments' });
	expect(submitted).toBe(false);
	expect(workModeUpdates).toBe(0);
});
