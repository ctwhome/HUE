import { afterEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HUEStore } from './store';

const databases: string[] = [];

afterEach(() => {
	for (const path of databases.splice(0)) rmSync(path, { force: true });
});

function seededStore(filename = ':memory:') {
	const store = new HUEStore(filename);
	store.createProject({ id: 'project-1', name: 'Private project', rootPath: '/private/work' });
	store.upsertSession('project-1', {
		sessionId: 'session-1',
		cwd: '/private/work',
		title: 'Private session'
	});
	return store;
}

describe('durable notification projection', () => {
	it('projects exactly five semantic kinds once and ignores routine events', () => {
		const store = seededStore();
		for (const [type, payload] of [
			['message.completed', { messageId: 'message-1' }],
			['agent.permission', { id: 'permission-1', status: 'pending' }],
			['agent.clarify', { id: 'clarify-1', status: 'pending' }],
			['message.failed', { messageId: 'message-2', error: 'private failure detail' }],
			['message.unknown', { messageId: 'message-3', error: 'private uncertainty detail' }],
			['agent.tool', { args: { token: 'secret' } }],
			['agent.chunk', { text: 'private transcript' }],
			['agent.permission', { id: 'permission-1', status: 'resolved' }]
		] as const) {
			store.appendEvent('project-1', 'session-1', type, payload);
		}

		const notifications = store.listNotifications({ limit: 20 });
		expect(notifications.items.map(({ kind }) => kind).sort()).toEqual([
			'clarify',
			'completed',
			'failed',
			'permission',
			'unknown'
		]);
		expect(new Set(notifications.items.map(({ sourceEventId }) => sourceEventId)).size).toBe(5);
		for (const notification of notifications.items) {
			expect(new URL(notification.path, 'http://hue.local').searchParams.get('event')).toBe(
				notification.sourceEventId
			);
		}
		expect(notifications.items.every(({ projectId }) => projectId === 'project-1')).toBe(true);
		expect(notifications.items.every(({ sessionId }) => sessionId === 'session-1')).toBe(true);
		expect(JSON.stringify(notifications)).not.toMatch(
			/Private project|Private session|private failure|private uncertainty|private transcript|secret/i
		);
		expect(store.notificationCounts()).toEqual({ unread: 5, all: 5 });
		store.close();
	});

	it('projects pre-existing events after restart without duplicates', () => {
		const path = join(tmpdir(), `hue-notifications-${crypto.randomUUID()}.db`);
		databases.push(path);
		const store = seededStore(path);
		const event = store.appendEvent('project-1', 'session-1', 'message.completed', {
			messageId: 'message-1'
		});
		const first = store.listNotifications({ limit: 10 }).items[0]!;
		store.database
			.query('UPDATE notifications SET path = ? WHERE id = ?')
			.run('/?project=project-1&session=session-1', first.id);
		store.database.exec('PRAGMA user_version = 0');
		store.close();

		const restarted = new HUEStore(path);
		restarted.projectPendingNotifications();
		restarted.projectPendingNotifications();

		expect(restarted.listNotifications({ limit: 10 }).items).toEqual([first]);
		expect(first.sourceEventId).toBe(String(event.sequence));
		restarted.close();
	});

	it('paginates newest first and preserves read dismiss acted lifecycle', () => {
		const store = seededStore();
		for (let index = 0; index < 4; index += 1) {
			store.appendEvent('project-1', 'session-1', 'message.completed', {
				messageId: `message-${index}`
			});
		}

		const first = store.listNotifications({ limit: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.nextCursor).toBeTruthy();
		const second = store.listNotifications({ limit: 2, cursor: first.nextCursor });
		expect(second.items).toHaveLength(2);
		expect(second.items.map(({ id }) => id)).not.toContain(first.items[0]!.id);

		const id = first.items[0]!.id;
		store.updateNotification(id, 'read');
		store.updateNotification(id, 'dismissed');
		store.updateNotification(id, 'acted');
		expect(store.getNotification(id)).toMatchObject({
			readAt: expect.any(String),
			dismissedAt: expect.any(String),
			actedAt: expect.any(String)
		});
		expect(store.listNotifications({ unreadOnly: true, limit: 10 }).items).toHaveLength(3);
		store.close();
	});

	it('marks an acted notification read in the same canonical mutation', () => {
		const store = seededStore();
		store.appendEvent('project-1', 'session-1', 'message.completed', {});
		const id = store.listNotifications({ limit: 1 }).items[0]!.id;

		expect(store.updateNotification(id, 'acted')).toMatchObject({
			actedAt: expect.any(String),
			readAt: expect.any(String)
		});
		expect(store.notificationCounts().unread).toBe(0);
		store.close();
	});

	it('marks every unread notification read at once', () => {
		const store = seededStore();
		for (let index = 0; index < 3; index += 1) {
			store.appendEvent('project-1', 'session-1', 'message.completed', {
				messageId: `message-${index}`
			});
		}

		expect(store.markAllNotificationsRead()).toBe(3);
		expect(store.notificationCounts()).toEqual({ unread: 0, all: 3 });
		expect(
			store.listNotifications({ limit: 10 }).items.every(({ readAt }) => Boolean(readAt))
		).toBe(true);
		store.close();
	});

	it('exposes exact interaction identity and current pending relevance for safe visual grouping', () => {
		const store = seededStore();
		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-1',
			status: 'pending'
		});
		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-1',
			status: 'pending'
		});
		let permissions = store
			.listNotifications({ limit: 10 })
			.items.filter(({ kind }) => kind === 'permission');

		expect(permissions).toHaveLength(2);
		expect(permissions.every(({ interactionId }) => interactionId === 'permission-1')).toBe(true);
		expect(permissions.every(({ currentRelevant }) => currentRelevant)).toBe(true);

		store.appendEvent('project-1', 'session-1', 'agent.permission', {
			id: 'permission-1',
			status: 'resolved'
		});
		permissions = store
			.listNotifications({ limit: 10 })
			.items.filter(({ kind }) => kind === 'permission');
		expect(permissions.every(({ currentRelevant }) => !currentRelevant)).toBe(true);
		store.close();
	});

	it('keeps durable notifications visible when source events are removed', () => {
		const store = seededStore();
		const event = store.appendEvent('project-1', 'session-1', 'message.completed', {});
		store.database.query('DELETE FROM session_events WHERE sequence = ?').run(event.sequence);

		expect(store.listNotifications({ limit: 10 }).items).toHaveLength(1);
		store.close();
	});
});
