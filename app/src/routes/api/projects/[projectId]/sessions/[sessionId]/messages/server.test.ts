import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let submitted = false;
let envelope: Record<string, unknown> | null = null;
const metadataIds: string[] = [];
const sessionProjectIds: string[] = [];
const operationReferences: string[] = [];
let updatedEnvelope: Record<string, unknown> | null = null;
mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => ({ id: 'project' }),
	services: () => ({
		store: {
			ensureProjectMetadata: (id: string) => metadataIds.push(id),
			hasSession: (id: string) => {
				sessionProjectIds.push(id);
				return true;
			}
		},
		dispatcher: {
			submit: (input: Record<string, unknown>) => {
				submitted = true;
				envelope = input;
				return { duplicate: false, status: 'queued' };
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
	expect(metadataIds).toEqual(['canonical-project']);
	expect(sessionProjectIds).toEqual(['canonical-project']);
	expect(envelope).toMatchObject({ projectId: 'canonical-project', sessionId: 'session' });
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
