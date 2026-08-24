import { expect, mock, test } from 'bun:test';
import { NotificationService } from '$lib/server/notifications';
import { serviceExportStubs } from '$lib/server/services-test-stubs';
import { HUEStore } from '$lib/server/store';

const store = new HUEStore(':memory:');
store.upsertSession(null, { sessionId: 'session-1', cwd: '/private/session' });
store.appendEvent(null, 'session-1', 'message.completed', { messageId: 'private-message' });
const notifications = new NotificationService(store, {});

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({ store, notifications })
}));

function mutation(url: string, body: unknown, origin = 'http://localhost') {
	return new Request(url, {
		method: 'POST',
		headers: { host: 'localhost', origin, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

test('lists bounded canonical metadata and counts', async () => {
	const { GET } = await import('./+server');
	const response = await GET({
		url: new URL('http://localhost/api/notifications?view=unread&limit=20')
	} as never);
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body.counts).toEqual({ unread: 1, all: 1 });
	expect(body.items).toEqual([
		expect.objectContaining({ kind: 'completed', projectId: null, sessionId: 'session-1' })
	]);
	expect(new URL(body.items[0].path, 'http://localhost').searchParams.get('event')).toBe(
		body.items[0].sourceEventId
	);
	expect(JSON.stringify(body)).not.toContain('private-message');
});

test('notification lifecycle mutations require exact same origin', async () => {
	const id = store.listNotifications({ limit: 1 }).items[0]!.id;
	const { PATCH } = await import('./[notificationId]/+server');
	for (const request of [
		new Request(`http://localhost/api/notifications/${id}`, {
			method: 'PATCH',
			headers: { host: 'localhost' },
			body: '{}'
		}),
		new Request(`http://localhost/api/notifications/${id}`, {
			method: 'PATCH',
			headers: { host: 'localhost', origin: 'https://attacker.example' },
			body: '{}'
		})
	]) {
		const response = await PATCH({
			params: { notificationId: id },
			request,
			url: new URL(request.url)
		} as never);
		expect(response.status).toBe(403);
	}
	const request = new Request(`http://localhost/api/notifications/${id}`, {
		method: 'PATCH',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: JSON.stringify({ state: 'read' })
	});
	const response = await PATCH({
		params: { notificationId: id },
		request,
		url: new URL(request.url)
	} as never);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual(expect.objectContaining({ readAt: expect.any(String) }));
});

test('marks all unread notifications read with one same-origin mutation', async () => {
	store.appendEvent(null, 'session-1', 'message.completed', { messageId: crypto.randomUUID() });
	const { PATCH } = await import('./+server');
	const request = new Request('http://localhost/api/notifications', {
		method: 'PATCH',
		headers: { host: 'localhost', origin: 'http://localhost' }
	});
	const response = await PATCH({ request, url: new URL(request.url) } as never);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ updated: 1, counts: { unread: 0, all: 2 } });
});

test('endpoint and presence APIs return safe metadata and support rename disable revoke delete', async () => {
	const endpointsRoute = await import('./endpoints/+server');
	const created = await endpointsRoute.POST({
		request: mutation('http://localhost/api/notifications/endpoints', {
			deviceId: 'device-api',
			name: 'Phone',
			endpoint: 'https://push.example.test/private-token',
			keys: { p256dh: 'B'.repeat(65), auth: 'a'.repeat(24) }
		}),
		url: new URL('http://localhost/api/notifications/endpoints')
	} as never);
	expect(created.status).toBe(200);
	const endpoint = await created.json();
	expect(JSON.stringify(endpoint)).not.toMatch(/private-token|BBBB|aaaa/);

	const endpointRoute = await import('./endpoints/[endpointId]/+server');
	const patchRequest = new Request(`http://localhost/api/notifications/endpoints/${endpoint.id}`, {
		method: 'PATCH',
		headers: { host: 'localhost', origin: 'http://localhost' },
		body: JSON.stringify({ name: 'Phone off', enabled: false })
	});
	const updated = await endpointRoute.PATCH({
		params: { endpointId: endpoint.id },
		request: patchRequest,
		url: new URL(patchRequest.url)
	} as never);
	expect(await updated.json()).toEqual(
		expect.objectContaining({ name: 'Phone off', enabled: false })
	);

	const presenceRoute = await import('./presence/+server');
	const presence = await presenceRoute.POST({
		request: mutation('http://localhost/api/notifications/presence', {
			endpointId: endpoint.id,
			projectId: null,
			sessionId: 'session-1',
			visible: true
		}),
		url: new URL('http://localhost/api/notifications/presence')
	} as never);
	expect(presence.status).toBe(204);

	for (const action of ['revoke', 'delete']) {
		const request = new Request(`http://localhost/api/notifications/endpoints/${endpoint.id}`, {
			method: action === 'delete' ? 'DELETE' : 'PATCH',
			headers: { host: 'localhost', origin: 'http://localhost' },
			body: action === 'revoke' ? JSON.stringify({ revoke: true }) : undefined
		});
		const response = await endpointRoute[action === 'delete' ? 'DELETE' : 'PATCH']({
			params: { endpointId: endpoint.id },
			request,
			url: new URL(request.url)
		} as never);
		expect(response.status).toBe(200);
	}
	expect(notifications.listEndpoints()).toEqual([]);
});

test('status API reports Web Push unavailable without returning secret config', async () => {
	const { GET } = await import('./status/+server');
	const response = await GET({} as never);
	expect(await response.json()).toEqual({
		available: false,
		publicKey: null,
		reason: 'not-configured'
	});
});
