import type { HUEStore, NotificationKind } from './store';
import webPush from 'web-push';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	writeSync
} from 'node:fs';
import { dirname, join } from 'node:path';

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushTransport = { send(target: PushTarget, payload: string): Promise<unknown> };

type VapidConfig = { publicKey: string; privateKey: string; subject: string };
type NotificationOptions = {
	vapid?: VapidConfig | null;
	transport?: PushTransport;
	now?: () => Date;
	allowHttpLocalhost?: boolean;
	configurationReason?: 'invalid-config';
	credentialKeyPath?: string;
	retryBaseMs?: number;
};

export function notificationOptionsFromEnv(
	env: Record<string, string | undefined>
): Pick<NotificationOptions, 'vapid' | 'configurationReason' | 'credentialKeyPath'> {
	const publicKey = env.HUE_VAPID_PUBLIC_KEY?.trim();
	const privateKey = env.HUE_VAPID_PRIVATE_KEY?.trim();
	const subject = env.HUE_VAPID_SUBJECT?.trim();
	const credentialKeyPath = env.HUE_NOTIFICATION_KEY_PATH?.trim() || undefined;
	if (!publicKey && !privateKey && !subject) return { credentialKeyPath };
	if (!publicKey || !privateKey || !subject)
		return { configurationReason: 'invalid-config', credentialKeyPath };
	return { vapid: { publicKey, privateKey, subject }, credentialKeyPath };
}
type WebPushClient = {
	setVapidDetails(subject: string, publicKey: string, privateKey: string): unknown;
	sendNotification(
		subscription: PushTarget,
		payload: string,
		options: { TTL: number }
	): Promise<unknown>;
};

export function createWebPushTransport(
	vapid: VapidConfig,
	client: WebPushClient = webPush
): PushTransport {
	client.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
	return {
		send: (target, payload) => client.sendNotification(target, payload, { TTL: 300 })
	};
}
type EndpointInput = {
	deviceId: string;
	name: string;
	endpoint: string;
	keys: { p256dh: string; auth: string };
};
export type EndpointMetadata = {
	id: string;
	deviceId: string;
	name: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	revokedAt: string | null;
};
export type DeliveryAttempt = {
	id: string;
	notificationId: string;
	endpointId: string;
	status: 'queued' | 'retry' | 'accepted' | 'expired' | 'suppressed';
	attemptCount: number;
	errorCategory: string | null;
	updatedAt: string;
};

type EndpointRow = {
	id: string;
	device_id: string;
	name: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	enabled: number;
	created_at: string;
	updated_at: string;
	revoked_at: string | null;
	notification_baseline: number;
};

type AttemptRow = {
	id: string;
	notification_id: string;
	endpoint_id: string;
	status: DeliveryAttempt['status'];
	attempt_count: number;
	error_category: string | null;
	updated_at: string;
};

export class NotificationService {
	private readonly now: () => Date;
	private readonly transport: PushTransport | null;
	private readonly configurationReason: 'not-configured' | 'invalid-config' | null;
	private readonly credentialKey: Buffer;
	private readonly retryBaseMs: number;
	private delivery: Promise<void> | null = null;
	private deliveryRequested = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(
		private readonly store: HUEStore,
		private readonly options: NotificationOptions = {}
	) {
		this.now = options.now ?? (() => new Date());
		let transport = options.transport ?? null;
		let reason: typeof this.configurationReason = options.configurationReason ?? null;
		if (!transport && options.vapid && !reason) {
			try {
				transport = createWebPushTransport(options.vapid);
			} catch {
				reason = 'invalid-config';
			}
		}
		this.transport = transport;
		this.configurationReason = reason ?? (options.vapid ? null : 'not-configured');
		this.retryBaseMs = Math.max(1, options.retryBaseMs ?? 60_000);
		this.credentialKey = loadCredentialKey(store, options.credentialKeyPath);
		this.migratePlaintextCredentials();
		if (this.transport && !this.configurationReason)
			void this.deliverPending().catch(() => undefined);
	}

	status() {
		const vapid = this.options.vapid;
		return !this.configurationReason && vapid?.publicKey && vapid.privateKey && vapid.subject
			? { available: true, publicKey: vapid.publicKey, reason: null }
			: { available: false, publicKey: null, reason: this.configurationReason ?? 'invalid-config' };
	}

	upsertEndpoint(input: EndpointInput): EndpointMetadata {
		validateEndpoint(input, this.options.allowHttpLocalhost ?? false);
		const now = this.now().toISOString();
		const id = `endpoint:${crypto.randomUUID()}`;
		const current = this.endpointByDevice(input.deviceId.trim());
		const baseline = this.currentNotificationBaseline();
		this.store.database.transaction(() => {
			this.store.database
				.query(
					`INSERT INTO notification_endpoints
				 (id, device_id, name, endpoint, p256dh, auth, enabled, created_at, updated_at, revoked_at,
				  notification_baseline)
				 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)
				 ON CONFLICT(device_id) DO UPDATE SET name = excluded.name, endpoint = excluded.endpoint,
				 p256dh = excluded.p256dh, auth = excluded.auth, enabled = 1,
				 updated_at = excluded.updated_at, revoked_at = NULL,
				 notification_baseline = CASE
				  WHEN notification_endpoints.enabled = 0 OR notification_endpoints.revoked_at IS NOT NULL
				  THEN excluded.notification_baseline ELSE notification_endpoints.notification_baseline END`
				)
				.run(
					id,
					input.deviceId.trim(),
					input.name.trim(),
					this.encrypt(idForCredential(current, id), 'endpoint', input.endpoint),
					this.encrypt(idForCredential(current, id), 'p256dh', input.keys.p256dh),
					this.encrypt(idForCredential(current, id), 'auth', input.keys.auth),
					now,
					now,
					baseline
				);
			if (current && (!current.enabled || current.revokedAt))
				this.suppressEndpointAttempts(current.id);
		})();
		return this.endpointByDevice(input.deviceId.trim())!;
	}

	listEndpoints(): EndpointMetadata[] {
		return (
			this.store.database
				.query(
					`SELECT id, device_id, name, endpoint, p256dh, auth, enabled, created_at, updated_at, revoked_at,
					 notification_baseline
					 FROM notification_endpoints ORDER BY created_at, id`
				)
				.all() as EndpointRow[]
		).map(mapEndpoint);
	}

	updateEndpoint(id: string, input: { enabled?: boolean; name?: string }): EndpointMetadata {
		if (input.name !== undefined) validateName(input.name);
		if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
			throw new Error('Endpoint enabled must be boolean');
		}
		const current = this.rawEndpoint(id);
		if (!current) throw new Error('Notification endpoint not found');
		const enabled = input.enabled ?? !!current.enabled;
		const reenabled = enabled && !current.enabled;
		this.store.database.transaction(() => {
			this.store.database
				.query(
					`UPDATE notification_endpoints SET name = ?, enabled = ?, updated_at = ?,
					 notification_baseline = CASE WHEN ? THEN ? ELSE notification_baseline END WHERE id = ?`
				)
				.run(
					input.name?.trim() ?? current.name,
					enabled ? 1 : 0,
					this.now().toISOString(),
					reenabled ? 1 : 0,
					this.currentNotificationBaseline(),
					id
				);
			if (!enabled || reenabled) this.suppressEndpointAttempts(id);
		})();
		return mapEndpoint(this.rawEndpoint(id)!);
	}

	revokeEndpoint(id: string): EndpointMetadata {
		const now = this.now().toISOString();
		const result = this.store.database
			.query(
				'UPDATE notification_endpoints SET enabled = 0, revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ?'
			)
			.run(now, now, id);
		if (!result.changes) throw new Error('Notification endpoint not found');
		this.suppressEndpointAttempts(id);
		return mapEndpoint(this.rawEndpoint(id)!);
	}

	deleteEndpoint(id: string): boolean {
		return !!this.store.database.query('DELETE FROM notification_endpoints WHERE id = ?').run(id)
			.changes;
	}

	reportPresence(
		endpointId: string,
		input: { projectId: string | null; sessionId: string | null; visible: boolean }
	): void {
		if (!this.rawEndpoint(endpointId)) throw new Error('Notification endpoint not found');
		if (input.projectId !== null && (!input.projectId || input.projectId.length > 200)) {
			throw new Error('Invalid presence Project');
		}
		if (input.sessionId !== null && (!input.sessionId || input.sessionId.length > 300)) {
			throw new Error('Invalid presence Session');
		}
		const expires = new Date(this.now().getTime() + 90_000).toISOString();
		this.store.database
			.query(
				`INSERT INTO notification_presence (endpoint_id, project_id, session_id, visible, expires_at)
				 VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint_id) DO UPDATE SET
				 project_id = excluded.project_id, session_id = excluded.session_id,
				 visible = excluded.visible, expires_at = excluded.expires_at`
			)
			.run(endpointId, input.projectId, input.sessionId, input.visible ? 1 : 0, expires);
	}

	deliverPending(): Promise<void> {
		if (this.closed) return Promise.resolve();
		this.deliveryRequested = true;
		if (this.delivery) return this.delivery;
		const delivery = this.runDelivery();
		this.delivery = delivery;
		const clear = () => {
			if (this.delivery === delivery) {
				this.delivery = null;
				if (this.deliveryRequested) void this.deliverPending().catch(() => undefined);
				else this.armScheduler();
			}
		};
		void delivery.then(clear, clear);
		return delivery;
	}

	close(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private async runDelivery(): Promise<void> {
		while (this.deliveryRequested && !this.closed) {
			this.deliveryRequested = false;
			await this.processPending();
		}
	}

	private async processPending(): Promise<void> {
		const status = this.status();
		if (!status.available || !this.transport) return;
		const now = this.now().toISOString();
		this.suppressInactiveAttempts();
		this.store.database
			.query(
				`INSERT OR IGNORE INTO notification_delivery_attempts
				 (id, notification_id, endpoint_id, status, next_attempt_at, created_at, updated_at)
				 SELECT 'attempt:' || n.id || ':' || e.id, n.id, e.id, 'queued', ?, ?, ?
					 FROM notifications n CROSS JOIN notification_endpoints e
					 WHERE e.enabled = 1 AND e.revoked_at IS NULL
					 AND CAST(n.source_event_id AS INTEGER) > e.notification_baseline
					 AND n.read_at IS NULL AND n.dismissed_at IS NULL AND n.acted_at IS NULL
					 AND ${pendingInteractionSql('n')}`
			)
			.run(now, now, now);
		const rows = this.store.database
			.query(
				`SELECT a.id, a.notification_id, a.endpoint_id, a.attempt_count,
				 e.endpoint, e.p256dh, e.auth,
				 n.project_id, n.session_id, n.kind, n.title, n.body, n.path,
				 p.project_id AS visible_project_id, p.session_id AS visible_session_id,
				 p.visible, p.expires_at
				 FROM notification_delivery_attempts a
				 JOIN notification_endpoints e ON e.id = a.endpoint_id
				 JOIN notifications n ON n.id = a.notification_id
				 LEFT JOIN notification_presence p ON p.endpoint_id = e.id
					 WHERE a.status IN ('queued', 'retry') AND a.next_attempt_at <= ?
					 AND e.enabled = 1 AND e.revoked_at IS NULL
					 AND n.read_at IS NULL AND n.dismissed_at IS NULL AND n.acted_at IS NULL
					 AND ${pendingInteractionSql('n')}
				 ORDER BY a.created_at, a.id`
			)
			.all(now) as Array<{
			id: string;
			notification_id: string;
			endpoint_id: string;
			attempt_count: number;
			endpoint: string;
			p256dh: string;
			auth: string;
			project_id: string | null;
			session_id: string;
			kind: NotificationKind;
			title: string;
			body: string;
			path: string;
			visible_project_id: string | null;
			visible_session_id: string | null;
			visible: number | null;
			expires_at: string | null;
		}>;
		for (const row of rows) {
			const exactVisible =
				row.visible === 1 &&
				row.expires_at !== null &&
				row.expires_at > now &&
				row.visible_project_id === row.project_id &&
				row.visible_session_id === row.session_id;
			if (exactVisible && row.kind !== 'permission' && row.kind !== 'clarify') {
				this.finishAttempt(row.id, 'suppressed', row.attempt_count, 'visible-context');
				continue;
			}
			const payload = JSON.stringify({
				id: row.notification_id,
				kind: row.kind,
				title: row.title,
				body: row.body,
				path: row.path
			});
			try {
				await this.transport.send(
					{
						endpoint: this.decrypt(row.endpoint_id, 'endpoint', row.endpoint),
						keys: {
							p256dh: this.decrypt(row.endpoint_id, 'p256dh', row.p256dh),
							auth: this.decrypt(row.endpoint_id, 'auth', row.auth)
						}
					},
					payload
				);
				this.finishAttempt(row.id, 'accepted', row.attempt_count + 1, null);
			} catch (cause) {
				const statusCode = Number((cause as { statusCode?: unknown })?.statusCode);
				const gone = statusCode === 404 || statusCode === 410;
				const count = row.attempt_count + 1;
				if (gone) {
					this.store.database
						.query('UPDATE notification_endpoints SET enabled = 0, updated_at = ? WHERE id = ?')
						.run(this.now().toISOString(), row.endpoint_id);
				}
				if (gone || count >= 3)
					this.finishAttempt(row.id, 'expired', count, gone ? 'gone' : 'failed');
				else {
					const next = new Date(
						this.now().getTime() + this.retryBaseMs * 2 ** (count - 1)
					).toISOString();
					this.store.database
						.query(
							`UPDATE notification_delivery_attempts SET status = 'retry', attempt_count = ?,
							 error_category = 'temporary', next_attempt_at = ?, updated_at = ? WHERE id = ?`
						)
						.run(count, next, this.now().toISOString(), row.id);
				}
			}
		}
	}

	listAttempts(): DeliveryAttempt[] {
		return (
			this.store.database
				.query(
					`SELECT id, notification_id, endpoint_id, status, attempt_count, error_category, updated_at
					 FROM notification_delivery_attempts ORDER BY created_at, id`
				)
				.all() as AttemptRow[]
		).map((row) => ({
			id: row.id,
			notificationId: row.notification_id,
			endpointId: row.endpoint_id,
			status: row.status,
			attemptCount: row.attempt_count,
			errorCategory: row.error_category,
			updatedAt: row.updated_at
		}));
	}

	private finishAttempt(
		id: string,
		status: 'accepted' | 'expired' | 'suppressed',
		count: number,
		error: string | null
	): void {
		const now = this.now().toISOString();
		this.store.database
			.query(
				`UPDATE notification_delivery_attempts SET status = ?, attempt_count = ?, error_category = ?,
				 updated_at = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END WHERE id = ?`
			)
			.run(status, count, error, now, status, now, id);
	}

	private endpointByDevice(deviceId: string): EndpointMetadata | null {
		const row = this.store.database
			.query(
				`SELECT id, device_id, name, endpoint, p256dh, auth, enabled, created_at, updated_at, revoked_at,
				 notification_baseline
				 FROM notification_endpoints WHERE device_id = ?`
			)
			.get(deviceId) as EndpointRow | null;
		return row ? mapEndpoint(row) : null;
	}

	private rawEndpoint(id: string): EndpointRow | null {
		return this.store.database
			.query(
				`SELECT id, device_id, name, endpoint, p256dh, auth, enabled, created_at, updated_at, revoked_at,
				 notification_baseline
				 FROM notification_endpoints WHERE id = ?`
			)
			.get(id) as EndpointRow | null;
	}

	private currentNotificationBaseline(): number {
		return Number(
			(
				this.store.database
					.query(
						'SELECT COALESCE(MAX(CAST(source_event_id AS INTEGER)), 0) AS baseline FROM notifications'
					)
					.get() as { baseline: number }
			).baseline
		);
	}

	private suppressEndpointAttempts(endpointId: string): void {
		this.store.database
			.query(
				`UPDATE notification_delivery_attempts SET status = 'suppressed', error_category = 'endpoint-disabled',
				 updated_at = ? WHERE endpoint_id = ? AND status IN ('queued', 'retry')`
			)
			.run(this.now().toISOString(), endpointId);
	}

	private suppressInactiveAttempts(): void {
		this.store.database
			.query(
				`UPDATE notification_delivery_attempts AS a SET status = 'suppressed',
				 error_category = 'canonical-inactive', updated_at = ?
				 WHERE a.status IN ('queued', 'retry') AND EXISTS (
				  SELECT 1 FROM notifications n WHERE n.id = a.notification_id AND (
				   n.read_at IS NOT NULL OR n.dismissed_at IS NOT NULL OR n.acted_at IS NOT NULL OR
				   NOT (${pendingInteractionSql('n')})
				  )
				 )`
			)
			.run(this.now().toISOString());
	}

	private armScheduler(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.closed || !this.transport || this.configurationReason) return;
		const due = this.store.database
			.query(
				`SELECT MIN(next_attempt_at) AS next_attempt_at FROM notification_delivery_attempts
				 WHERE status IN ('queued', 'retry')`
			)
			.get() as { next_attempt_at: string | null };
		if (!due.next_attempt_at) return;
		const delay = Math.max(
			0,
			Math.min(Date.parse(due.next_attempt_at) - this.now().getTime(), 2_147_483_647)
		);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.deliverPending().catch(() => undefined);
		}, delay);
		this.timer.unref?.();
	}

	private migratePlaintextCredentials(): void {
		let migrated = false;
		for (;;) {
			const rows = this.store.database
				.query(
					`SELECT id, endpoint, p256dh, auth FROM notification_endpoints
					 WHERE endpoint NOT LIKE 'v1:%' OR p256dh NOT LIKE 'v1:%' OR auth NOT LIKE 'v1:%'
					 LIMIT 100`
				)
				.all() as Array<Pick<EndpointRow, 'id' | 'endpoint' | 'p256dh' | 'auth'>>;
			if (!rows.length) break;
			this.store.database.transaction(() => {
				for (const row of rows) {
					for (const value of [row.endpoint, row.p256dh, row.auth]) {
						if (value.startsWith('v') && !value.startsWith('v1:')) {
							throw new Error('Unsupported notification credential ciphertext version');
						}
					}
					if (
						(!row.endpoint.startsWith('v1:') && row.endpoint.length > 2048) ||
						(!row.p256dh.startsWith('v1:') && row.p256dh.length > 128) ||
						(!row.auth.startsWith('v1:') && row.auth.length > 64)
					) {
						throw new Error('Legacy notification credential exceeds migration bounds');
					}
					this.store.database
						.query(
							'UPDATE notification_endpoints SET endpoint = ?, p256dh = ?, auth = ? WHERE id = ?'
						)
						.run(
							row.endpoint.startsWith('v1:')
								? row.endpoint
								: this.encrypt(row.id, 'endpoint', row.endpoint),
							row.p256dh.startsWith('v1:')
								? row.p256dh
								: this.encrypt(row.id, 'p256dh', row.p256dh),
							row.auth.startsWith('v1:') ? row.auth : this.encrypt(row.id, 'auth', row.auth),
							row.id
						);
				}
			})();
			migrated = true;
		}
		if (migrated && this.store.filename !== ':memory:') {
			this.store.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
			this.store.database.exec('VACUUM');
			chmodSync(this.store.filename, 0o600);
		}
	}

	private encrypt(id: string, field: string, plaintext: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.credentialKey, iv);
		cipher.setAAD(Buffer.from(`${id}\0${field}`));
		const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
		return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
	}

	private decrypt(id: string, field: string, value: string): string {
		const [version, iv, tag, ciphertext, extra] = value.split(':');
		if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) {
			throw new Error('Invalid notification credential ciphertext');
		}
		const decipher = createDecipheriv(
			'aes-256-gcm',
			this.credentialKey,
			Buffer.from(iv, 'base64url')
		);
		decipher.setAAD(Buffer.from(`${id}\0${field}`));
		decipher.setAuthTag(Buffer.from(tag, 'base64url'));
		return Buffer.concat([
			decipher.update(Buffer.from(ciphertext, 'base64url')),
			decipher.final()
		]).toString('utf8');
	}
}

function idForCredential(current: EndpointMetadata | null, generated: string): string {
	return current?.id ?? generated;
}

function pendingInteractionSql(alias: string): string {
	return `(${alias}.kind NOT IN ('permission', 'clarify') OR NOT EXISTS (
	 SELECT 1 FROM session_events source JOIN session_events later
	  ON later.sequence > source.sequence AND later.project_id IS source.project_id
	  AND later.session_id = source.session_id AND later.type = source.type
	  AND json_extract(later.payload, '$.id') = json_extract(source.payload, '$.id')
	 WHERE source.sequence = CAST(${alias}.source_event_id AS INTEGER)
	))`;
}

function loadCredentialKey(store: HUEStore, configuredPath?: string): Buffer {
	if (store.filename === ':memory:' && !configuredPath) return randomBytes(32);
	const path = configuredPath ?? join(dirname(store.filename), 'notification.key');
	if (path === store.filename)
		throw new Error('Notification credential key must be outside database');
	const directory = dirname(path);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const directoryStat = lstatSync(directory);
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
		throw new Error('Notification credential key directory must be a real directory');
	}
	if ((directoryStat.mode & 0o777) !== 0o700) chmodSync(directory, 0o700);
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error('Notification credential key must be a regular file');
		}
		if ((stat.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
		const key = readFileSync(path);
		if (key.length !== 32) throw new Error('Notification credential key must contain 32 bytes');
		return key;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
	const key = randomBytes(32);
	let descriptor: number | null = null;
	try {
		descriptor = openSync(path, 'wx', 0o600);
		writeSync(descriptor, key);
		fsyncSync(descriptor);
		chmodSync(path, 0o600);
		return key;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
		const existing = readFileSync(path);
		if (existing.length !== 32)
			throw new Error('Notification credential key must contain 32 bytes');
		return existing;
	} finally {
		if (descriptor !== null) closeSync(descriptor);
	}
}

function mapEndpoint(row: EndpointRow): EndpointMetadata {
	return {
		id: row.id,
		deviceId: row.device_id,
		name: row.name,
		enabled: !!row.enabled,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		revokedAt: row.revoked_at
	};
}

function validateName(name: string) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
		throw new Error('Device name must be 1-80 characters');
	}
}

function validateEndpoint(input: EndpointInput, allowHttpLocalhost: boolean) {
	if (typeof input.deviceId !== 'string' || !input.deviceId.trim() || input.deviceId.length > 100) {
		throw new Error('Device id must be 1-100 characters');
	}
	validateName(input.name);
	if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) {
		throw new Error('Push endpoint is invalid');
	}
	let url: URL;
	try {
		url = new URL(input.endpoint);
	} catch {
		throw new Error('Push endpoint is invalid');
	}
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(allowHttpLocalhost && local && url.protocol === 'http:')) {
		throw new Error('Push endpoint must use HTTPS');
	}
	if (url.username || url.password || url.hash) throw new Error('Push endpoint is invalid');
	if (
		!input.keys ||
		typeof input.keys.p256dh !== 'string' ||
		input.keys.p256dh.length < 43 ||
		input.keys.p256dh.length > 128 ||
		!/^[A-Za-z0-9_-]+$/.test(input.keys.p256dh) ||
		typeof input.keys.auth !== 'string' ||
		input.keys.auth.length < 16 ||
		input.keys.auth.length > 64 ||
		!/^[A-Za-z0-9_-]+$/.test(input.keys.auth)
	) {
		throw new Error('Push subscription keys are invalid');
	}
}
