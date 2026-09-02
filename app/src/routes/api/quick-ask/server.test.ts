import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let generated: Record<string, unknown> | null = null;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	quickAskSessionRoot: () => '/work/quick',
	services: () => ({ store: {}, runtime: {}, dispatcher: {} })
}));

mock.module('$lib/server/quick-ask', () => ({
	generateQuickAsk: async (input: Record<string, unknown>) => {
		generated = input;
		return { status: 'completed', answer: 'Answer', sessionId: 'quick', messageId: 'operation' };
	},
	keepQuickAsk: () => ({ sessionId: 'quick', archived: false }),
	discardQuickAsk: async () => {}
}));

function event(origin: string, body: Record<string, unknown>) {
	const url = new URL('http://hue.test/api/quick-ask');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url
	} as never;
}

test('submits a bounded same-origin Quick Ask', async () => {
	generated = null;
	const { POST } = await import('./+server');
	const response = await POST(event('http://hue.test', { question: 'What is HUE?', operationId: 'quick-1' }));

	expect(response.status).toBe(200);
	expect(generated as Record<string, unknown> | null).toEqual({
		question: 'What is HUE?',
		operationId: 'quick-1',
		sessionRoot: '/work/quick'
	});
});

test('rejects cross-origin Quick Ask requests', async () => {
	const { POST } = await import('./+server');
	expect((await POST(event('https://attacker.example', { question: 'No', operationId: 'bad' }))).status).toBe(403);
});

test('rejects invalid Quick Ask input', async () => {
	const { POST } = await import('./+server');
	expect((await POST(event('http://hue.test', { question: '', operationId: 'quick-1' }))).status).toBe(400);
});
