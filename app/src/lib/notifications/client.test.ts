import { describe, expect, it } from 'bun:test';
import {
	acknowledgeThenNavigate,
	attentionState,
	notificationCapability,
	requestSystemPermission,
	shouldPresentForeground,
	shouldPlaySound
} from './client';

describe('notification client policy', () => {
	it('awaits acted acknowledgement before navigation and continues after failure', async () => {
		for (const fails of [false, true]) {
			const events: string[] = [];
			let release!: () => void;
			const pending = new Promise<void>((resolve) => (release = resolve));
			const result = acknowledgeThenNavigate(
				async () => {
					events.push('patch-start');
					await pending;
					if (fails) throw new Error('offline');
					events.push('patch-done');
				},
				() => events.push('focus'),
				() => events.push('navigate')
			);

			expect(events).toEqual(['patch-start']);
			release();
			await result;
			expect(events).toEqual(
				fails
					? ['patch-start', 'focus', 'navigate']
					: ['patch-start', 'patch-done', 'focus', 'navigate']
			);
		}
	});

	it('requests browser permission only from an explicit user gesture', async () => {
		let requests = 0;
		const api = {
			permission: 'default' as NotificationPermission,
			requestPermission: async () => {
				requests += 1;
				return 'granted' as NotificationPermission;
			}
		};
		expect(await requestSystemPermission(false, api)).toBe('default');
		expect(requests).toBe(0);
		expect(await requestSystemPermission(true, api)).toBe('granted');
		expect(requests).toBe(1);
	});

	it('reports denied unavailable insecure and push-unavailable states honestly', () => {
		expect(
			notificationCapability({
				secure: false,
				notification: true,
				push: true,
				permission: 'default'
			})
		).toBe('insecure');
		expect(
			notificationCapability({
				secure: true,
				notification: false,
				push: true,
				permission: 'default'
			})
		).toBe('unavailable');
		expect(
			notificationCapability({
				secure: true,
				notification: true,
				push: false,
				permission: 'default'
			})
		).toBe('push-unavailable');
		expect(
			notificationCapability({ secure: true, notification: true, push: true, permission: 'denied' })
		).toBe('denied');
		expect(
			notificationCapability({
				secure: true,
				notification: true,
				push: true,
				permission: 'granted'
			})
		).toBe('ready');
	});

	it('suppresses routine foreground alerts only for exact visible context', () => {
		const context = { projectId: 'project-1', sessionId: 'session-1', visible: true };
		const notification = { projectId: 'project-1', sessionId: 'session-1', kind: 'completed' };
		expect(shouldPresentForeground(notification, context)).toBe(false);
		expect(shouldPresentForeground({ ...notification, kind: 'permission' }, context)).toBe(true);
		expect(shouldPresentForeground({ ...notification, kind: 'clarify' }, context)).toBe(true);
		expect(shouldPresentForeground({ ...notification, sessionId: 'session-2' }, context)).toBe(
			true
		);
		expect(shouldPresentForeground(notification, { ...context, visible: false })).toBe(true);
	});

	it('plays foreground sound only after explicit opt-in and audio unlock', () => {
		expect(shouldPlaySound({ enabled: false, unlocked: true }, true)).toBe(false);
		expect(shouldPlaySound({ enabled: true, unlocked: false }, true)).toBe(false);
		expect(shouldPlaySound({ enabled: true, unlocked: true }, false)).toBe(false);
		expect(shouldPlaySound({ enabled: true, unlocked: true }, true)).toBe(true);
	});

	it('derives loading error empty and populated center states with unread badge', () => {
		expect(attentionState({ loading: true, error: '', items: [], unread: 0 })).toEqual({
			view: 'loading',
			badge: null
		});
		expect(attentionState({ loading: false, error: 'Offline', items: [], unread: 0 })).toEqual({
			view: 'error',
			badge: null
		});
		expect(attentionState({ loading: false, error: '', items: [], unread: 0 })).toEqual({
			view: 'empty',
			badge: null
		});
		expect(attentionState({ loading: false, error: '', items: [{}], unread: 120 })).toEqual({
			view: 'list',
			badge: '99+'
		});
	});
});
