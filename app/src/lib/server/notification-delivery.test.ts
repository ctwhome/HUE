import { describe, expect, it } from 'bun:test';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
	createWebPushTransport,
	notificationOptionsFromEnv,
	NotificationService,
	type PushTransport
} from './notifications';
import { HUEStore } from './store';

function setup() {
	const store = new HUEStore(':memory:');
	store.createProject({ id: 'project-1', name: 'Secret project', rootPath: '/secret/path' });
	store.upsertSession('project-1', {
		sessionId: 'session-1',
		cwd: '/secret/path',
		title: 'Secret session'
	});
	return store;
}

const subscription = {
	deviceId: 'device-1',
	name: 'My phone',
	endpoint: 'https://push.example.test/subscription-secret',
	keys: {
		p256dh: 'B'.repeat(65),
		auth: 'a'.repeat(24)
	}
};

describe('notification delivery boundary', () => {
	it('keeps database and credential key private and stores no raw subscription credentials', () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-notification-credentials-'));
		const directory = join(root, 'state');
		const databasePath = join(directory, 'hue.db');
		const keyPath = join(directory, 'notification.key');
		try {
			mkdirSync(directory, { mode: 0o777 });
			const store = new HUEStore(databasePath);
			chmodSync(databasePath, 0o666);
			store.close();

			const reopened = new HUEStore(databasePath);
			const service = new NotificationService(reopened, { credentialKeyPath: keyPath });
			service.upsertEndpoint(subscription);
			reopened.close();

			expect(lstatSync(directory).mode & 0o777).toBe(0o700);
			expect(lstatSync(databasePath).mode & 0o777).toBe(0o600);
			expect(lstatSync(keyPath).mode & 0o777).toBe(0o600);
			const database = readFileSync(databasePath);
			for (const secret of [
				subscription.endpoint,
				subscription.keys.p256dh,
				subscription.keys.auth
			]) {
				expect(database.includes(Buffer.from(secret))).toBe(false);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('migrates bounded plaintext subscription rows and decrypts only for transport', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-notification-migration-'));
		const databasePath = join(root, 'hue.db');
		try {
			const store = setupFileStore(databasePath);
			const now = new Date().toISOString();
			store.database
				.query(
					`INSERT INTO notification_endpoints
					 (id, device_id, name, endpoint, p256dh, auth, enabled, created_at, updated_at)
					 VALUES ('legacy', 'legacy-device', 'Legacy', ?, ?, ?, 1, ?, ?)`
				)
				.run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now);
			store.appendEvent('project-1', 'session-1', 'message.completed', {});
			const targets: unknown[] = [];
			const service = new NotificationService(store, {
				credentialKeyPath: join(root, 'notification.key'),
				vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
				transport: { send: async (target) => targets.push(target) }
			});

			const encrypted = store.database
				.query('SELECT endpoint, p256dh, auth FROM notification_endpoints WHERE id = ?')
				.get('legacy') as Record<string, string>;
			expect(Object.values(encrypted).every((value) => value.startsWith('v1:'))).toBe(true);
			await service.deliverPending();
			expect(targets).toEqual([{ endpoint: subscription.endpoint, keys: subscription.keys }]);
			store.close();
			const database = readFileSync(databasePath);
			for (const secret of [
				subscription.endpoint,
				subscription.keys.p256dh,
				subscription.keys.auth
			]) {
				expect(database.includes(Buffer.from(secret))).toBe(false);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('sets legacy endpoint baseline after projecting pre-existing events', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-notification-legacy-baseline-'));
		const databasePath = join(root, 'hue.db');
		try {
			const legacy = new Database(databasePath);
			legacy.exec(`
				CREATE TABLE session_events (
				 sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
				 type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
				);
				INSERT INTO session_events (session_id, type, payload, created_at)
				 VALUES ('session-old', 'message.completed', '{}', '2026-08-22T10:00:00.000Z');
				CREATE TABLE notification_endpoints (
				 id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
				 endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
				 enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
				 updated_at TEXT NOT NULL, revoked_at TEXT
				);
			`);
			legacy
				.query(
					`INSERT INTO notification_endpoints
					 VALUES ('legacy', 'legacy-device', 'Legacy', ?, ?, ?, 1,
					 '2026-08-23T10:00:00.000Z', '2026-08-23T10:00:00.000Z', NULL)`
				)
				.run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
			legacy.close();

			const store = new HUEStore(databasePath);
			const payloads: string[] = [];
			const service = new NotificationService(store, {
				credentialKeyPath: join(root, 'notification.key'),
				vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
				transport: { send: async (_target, payload) => payloads.push(payload) }
			});
			await service.deliverPending();

			expect(payloads).toEqual([]);
			expect(
				(
					store.database
						.query('SELECT notification_baseline AS baseline FROM notification_endpoints')
						.get() as { baseline: number }
				).baseline
			).toBe(1);
			service.close();
			store.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails closed when persistent credential key path is unavailable', () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-notification-key-failure-'));
		const blocked = join(root, 'blocked');
		try {
			mkdirSync(blocked);
			const store = setupFileStore(join(root, 'hue.db'));
			expect(() => new NotificationService(store, { credentialKeyPath: blocked })).toThrow();
			store.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it('reads only complete VAPID configuration and keeps partial config nonfatal', () => {
		expect(notificationOptionsFromEnv({})).toEqual({});
		expect(notificationOptionsFromEnv({ HUE_VAPID_PUBLIC_KEY: 'public' })).toEqual({
			configurationReason: 'invalid-config'
		});
		expect(
			notificationOptionsFromEnv({
				HUE_VAPID_PUBLIC_KEY: 'public',
				HUE_VAPID_PRIVATE_KEY: 'private',
				HUE_VAPID_SUBJECT: 'mailto:hue@example.test'
			})
		).toEqual({
			vapid: {
				publicKey: 'public',
				privateKey: 'private',
				subject: 'mailto:hue@example.test'
			}
		});
	});

	it('reports malformed configured keys without throwing during startup', () => {
		const service = new NotificationService(setup(), {
			vapid: { publicKey: 'bad', privateKey: 'bad', subject: 'bad' }
		});
		expect(service.status()).toEqual({
			available: false,
			publicKey: null,
			reason: 'invalid-config'
		});
	});

	it('configures VAPID and delegates encrypted delivery to maintained transport', async () => {
		const calls: unknown[][] = [];
		const transport = createWebPushTransport(
			{ publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			{
				setVapidDetails: (...args: unknown[]) => calls.push(['vapid', ...args]),
				sendNotification: async (...args: unknown[]) => calls.push(['send', ...args])
			}
		);
		await transport.send(
			{ endpoint: 'https://push.example.test/id', keys: { p256dh: 'key', auth: 'auth' } },
			'{"title":"Task completed"}'
		);
		expect(calls).toEqual([
			['vapid', 'mailto:hue@example.test', 'public', 'private'],
			[
				'send',
				{
					endpoint: 'https://push.example.test/id',
					keys: { p256dh: 'key', auth: 'auth' }
				},
				'{"title":"Task completed"}',
				{ TTL: 300 }
			]
		]);
	});

	it('reports missing VAPID configuration honestly without failing startup', () => {
		const service = new NotificationService(setup(), {});
		expect(service.status()).toEqual({
			available: false,
			publicKey: null,
			reason: 'not-configured'
		});
	});

	it('validates subscriptions and never returns raw endpoints or keys', () => {
		const store = setup();
		const service = new NotificationService(store, {});
		expect(() =>
			service.upsertEndpoint({ ...subscription, endpoint: 'http://push.example.test/token' })
		).toThrow('HTTPS');
		expect(() => service.upsertEndpoint({ ...subscription, name: 'x'.repeat(81) })).toThrow('1-80');

		const metadata = service.upsertEndpoint(subscription);
		expect(metadata).toMatchObject({ deviceId: 'device-1', name: 'My phone', enabled: true });
		expect(JSON.stringify(metadata)).not.toContain('subscription-secret');
		expect(JSON.stringify(service.listEndpoints())).not.toMatch(/subscription-secret|BBBB|aaaa/);
		store.close();
	});

	it('suppresses only matching endpoint context while retaining canonical notification', async () => {
		const store = setup();
		const sent: Array<{ endpoint: string; payload: string }> = [];
		const transport: PushTransport = {
			send: async (target, payload) => sent.push({ endpoint: target.endpoint, payload })
		};
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			transport
		});
		const visible = service.upsertEndpoint(subscription);
		service.upsertEndpoint({
			...subscription,
			deviceId: 'device-2',
			name: 'Laptop',
			endpoint: 'https://push.example.test/other-secret'
		});
		service.reportPresence(visible.id, {
			projectId: 'project-1',
			sessionId: 'session-1',
			visible: true
		});
		store.appendEvent('project-1', 'session-1', 'message.completed', { messageId: 'message-1' });

		await service.deliverPending();

		expect(store.notificationCounts()).toEqual({ unread: 1, all: 1 });
		expect(sent).toHaveLength(1);
		expect(sent[0]!.endpoint).toContain('other-secret');
		expect(sent[0]!.payload).not.toMatch(/Secret project|Secret session|secret\/path|message-1/i);
		expect(JSON.parse(sent[0]!.payload)).toEqual({
			id: expect.any(String),
			kind: 'completed',
			title: 'Task completed',
			body: 'Open HUE to review the result.',
			path: '/?project=project-1&session=session-1&event=1'
		});
		store.close();
	});

	it('never suppresses permission or clarify for visible exact context', async () => {
		const store = setup();
		const payloads: string[] = [];
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			transport: { send: async (_target, payload) => payloads.push(payload) }
		});
		const endpoint = service.upsertEndpoint(subscription);
		service.reportPresence(endpoint.id, {
			projectId: 'project-1',
			sessionId: 'session-1',
			visible: true
		});
		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-1',
			status: 'pending'
		});
		store.appendEvent('project-1', 'session-1', 'agent.clarify', {
			id: 'clarify-1',
			status: 'pending'
		});

		await service.deliverPending();
		expect(payloads).toHaveLength(2);
		store.close();
	});

	it('serializes overlapping recovery passes without duplicate endpoint delivery', async () => {
		const store = setup();
		let release!: () => void;
		let calls = 0;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			transport: {
				send: async () => {
					calls += 1;
					await blocked;
				}
			}
		});
		service.upsertEndpoint(subscription);
		store.appendEvent('project-1', 'session-1', 'message.completed', {});
		const first = service.deliverPending();
		const second = service.deliverPending();
		await Promise.resolve();
		release();
		await Promise.all([first, second]);
		expect(calls).toBe(1);
		store.close();
	});

	it('owns retry timing and wakes without polling or new events', async () => {
		const store = setup();
		let calls = 0;
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			retryBaseMs: 10,
			transport: {
				send: async () => {
					calls += 1;
					if (calls === 1) throw Object.assign(new Error('temporary'), { statusCode: 503 });
				}
			}
		});
		service.upsertEndpoint(subscription);
		store.appendEvent('project-1', 'session-1', 'message.completed', {});

		await service.deliverPending();
		await waitFor(() => calls === 2);

		expect(service.listAttempts()).toEqual([
			expect.objectContaining({ status: 'accepted', attemptCount: 2 })
		]);
		service.close();
		store.close();
	});

	it('recovers due retry scheduling after service reset', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-notification-scheduler-'));
		const databasePath = join(root, 'hue.db');
		const keyPath = join(root, 'notification.key');
		try {
			const store = setupFileStore(databasePath);
			const first = new NotificationService(store, {
				credentialKeyPath: keyPath,
				vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
				retryBaseMs: 10,
				transport: { send: async () => Promise.reject(new Error('temporary')) }
			});
			first.upsertEndpoint(subscription);
			store.appendEvent('project-1', 'session-1', 'message.completed', {});
			await first.deliverPending();
			first.close();
			await Bun.sleep(20);

			let calls = 0;
			const restarted = new NotificationService(store, {
				credentialKeyPath: keyPath,
				vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
				retryBaseMs: 10,
				transport: { send: async () => void (calls += 1) }
			});
			await waitFor(() => calls === 1);
			expect(restarted.listAttempts()[0]).toMatchObject({ status: 'accepted', attemptCount: 2 });
			restarted.close();
			store.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fans out only active notifications newer than endpoint baseline', async () => {
		const store = setup();
		store.appendEvent('project-1', 'session-1', 'message.completed', {});
		const payloads: string[] = [];
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			transport: { send: async (_target, payload) => payloads.push(payload) }
		});
		const endpoint = service.upsertEndpoint(subscription);
		await service.deliverPending();
		expect(payloads).toEqual([]);

		for (const state of ['read', 'dismissed', 'acted'] as const) {
			store.appendEvent('project-1', 'session-1', 'message.completed', {});
			store.updateNotification(store.listNotifications({ limit: 1 }).items[0]!.id, state);
		}
		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-resolved',
			status: 'pending'
		});
		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-resolved',
			status: 'resolved'
		});
		await service.deliverPending();
		expect(payloads).toEqual([]);

		service.updateEndpoint(endpoint.id, { enabled: false });
		store.appendEvent('project-1', 'session-1', 'message.failed', {});
		service.updateEndpoint(endpoint.id, { enabled: true });
		await service.deliverPending();
		expect(payloads).toEqual([]);

		store.appendEvent('project-1', 'session-1', 'message.completed', {});
		await service.deliverPending();
		expect(payloads).toHaveLength(1);
		service.close();
		store.close();
	});

	it('records bounded retries and disables gone endpoints without exposing credentials', async () => {
		const store = setup();
		let now = Date.parse('2026-08-23T10:00:00.000Z');
		let calls = 0;
		const service = new NotificationService(store, {
			vapid: { publicKey: 'public', privateKey: 'private', subject: 'mailto:hue@example.test' },
			now: () => new Date(now),
			transport: {
				send: async () => {
					calls += 1;
					if (calls < 3) throw Object.assign(new Error('subscription-secret'), { statusCode: 503 });
					throw Object.assign(new Error('gone subscription-secret'), { statusCode: 410 });
				}
			}
		});
		const endpoint = service.upsertEndpoint(subscription);
		store.appendEvent('project-1', 'session-1', 'message.failed', { error: 'private error' });

		await service.deliverPending();
		now += 60_000;
		await service.deliverPending();
		now += 120_000;
		await service.deliverPending();

		expect(calls).toBe(3);
		expect(service.listEndpoints()).toEqual([
			expect.objectContaining({ id: endpoint.id, enabled: false })
		]);
		const attempts = service.listAttempts();
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({
			status: 'expired',
			attemptCount: 3,
			errorCategory: 'gone'
		});
		expect(JSON.stringify(attempts)).not.toContain('subscription-secret');
		store.close();
	});

	it('supports disable rename revoke and delete using safe metadata', () => {
		const store = setup();
		const service = new NotificationService(store, {});
		const endpoint = service.upsertEndpoint(subscription);
		expect(
			service.updateEndpoint(endpoint.id, { enabled: false, name: 'Phone off' })
		).toMatchObject({
			name: 'Phone off',
			enabled: false
		});
		expect(service.revokeEndpoint(endpoint.id)).toMatchObject({ revokedAt: expect.any(String) });
		expect(service.deleteEndpoint(endpoint.id)).toBe(true);
		expect(service.listEndpoints()).toEqual([]);
		store.close();
	});
});

function setupFileStore(path: string) {
	const store = new HUEStore(path);
	store.createProject({ id: 'project-1', name: 'Secret project', rootPath: '/secret/path' });
	store.upsertSession('project-1', {
		sessionId: 'session-1',
		cwd: '/secret/path',
		title: 'Secret session'
	});
	return store;
}

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for notification delivery');
		await Bun.sleep(5);
	}
}
