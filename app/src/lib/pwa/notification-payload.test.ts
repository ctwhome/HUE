import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationDisplayOptions, parsePushPayload } from './notification-payload';

test('accepts only bounded generic push fields and same-origin path', () => {
	const parsed = parsePushPayload({
		id: 'notification:1',
		kind: 'completed',
		title: 'Task completed',
		body: 'Open HUE to review the result.',
		path: '/?project=project-1&session=session-1',
		prompt: 'private prompt',
		toolArgs: { token: 'secret' },
		action: 'approve'
	});
	expect(parsed).toEqual({
		id: 'notification:1',
		kind: 'completed',
		title: 'Task completed',
		body: 'Open HUE to review the result.',
		path: '/?project=project-1&session=session-1'
	});
	expect(JSON.stringify(parsed)).not.toMatch(/private prompt|secret|approve/);
});

test('falls back to generic copy and root for malformed or external payloads', () => {
	for (const value of [null, 'bad', { path: 'https://attacker.example', title: 'Private' }]) {
		expect(parsePushPayload(value)).toEqual({
			id: null,
			kind: 'unknown',
			title: 'HUE notification',
			body: 'Open HUE to review.',
			path: '/'
		});
	}
});

test('display options contain only safe open action and generic HUE assets', () => {
	const payload = parsePushPayload({
		id: 'notification:1',
		kind: 'permission',
		title: 'HUE needs permission',
		body: 'Open HUE to review the request.',
		path: '/?project=none&session=session-1'
	});
	expect(notificationDisplayOptions(payload)).toEqual({
		body: payload.body,
		icon: '/icons/hue-192.png',
		badge: '/icons/hue-192.png',
		tag: 'notification:1',
		data: { id: 'notification:1', url: payload.path },
		actions: [{ action: 'open', title: 'Open HUE' }]
	});
});

test('service worker handles push click close and never exposes authority action', () => {
	const source = readFileSync(join(import.meta.dir, '../../service-worker.ts'), 'utf8');
	expect(source).toContain("addEventListener('push'");
	expect(source).toContain("addEventListener('notificationclick'");
	expect(source).toContain("addEventListener('notificationclose'");
	expect(source).toContain('safeLaunchUrl');
	expect(source).toContain('client.focus()');
	expect(source).toContain('openWindow(url)');
	expect(source).toContain("JSON.stringify({ state: 'acted' })");
	expect(source).toContain("method: 'PATCH'");
	expect(source).not.toContain('/api/notifications?view=unread');
	expect(source.indexOf("JSON.stringify({ state: 'acted' })")).toBeLessThan(
		source.indexOf("matchAll({ type: 'window'")
	);
	expect(source).not.toMatch(/action:\s*['"](?:approve|allow|answer)/);
});
