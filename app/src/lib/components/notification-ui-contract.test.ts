import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');

test('global attention entry has accessible unread badge and center states', () => {
	const navigation = component('GlobalNavigation.svelte');
	const center = component('notifications/AttentionCenter.svelte');
	expect(navigation).toContain('aria-label={`Notifications');
	expect(navigation).toContain('notification-badge');
	for (const state of [
		'Loading notifications',
		'Unable to load notifications',
		'No notifications'
	]) {
		expect(center).toContain(state);
	}
	expect(center).toContain('Mark read');
	expect(center).toContain('Mark all read');
	expect(center).toContain('Dismiss');
	expect(center).toContain('Notification settings');
	expect(center).toContain('acknowledgeThenNavigate');
});

test('settings explain explicit permission sound and device limitations', () => {
	const center = component('notifications/AttentionCenter.svelte');
	expect(center).toContain('Enable system notifications');
	expect(center).toContain('Notification.requestPermission');
	expect(center).toContain('Foreground sound');
	expect(center).toContain('user gesture');
	expect(center).toMatch(/Background PWA sound\s+follows browser and operating-system settings/);
	expect(center).toContain('Wear OS mirroring is best effort');
	expect(center).toContain('Revoke');
	expect(center).toContain('Delete');
});
