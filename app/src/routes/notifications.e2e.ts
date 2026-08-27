import { expect, test } from '@playwright/test';
import webPush from 'web-push';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 844 }
];

type Item = {
	id: string;
	projectId: string | null;
	sessionId: string;
	kind: 'completed' | 'permission' | 'clarify' | 'failed' | 'unknown';
	priority: 'normal' | 'high';
	title: string;
	body: string;
	path: string;
	createdAt: string;
	readAt: string | null;
	dismissedAt: string | null;
	actedAt: string | null;
	interactionId?: string | null;
	currentRelevant?: boolean;
};

async function expectMinimumTouchTargets(locator: import('@playwright/test').Locator) {
	for (const target of await locator.all()) {
		if (await target.isVisible())
			expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	}
}

function item(kind: Item['kind'], index: number): Item {
	const copy = {
		completed: ['Task completed', 'Open HUE to review the result.'],
		permission: ['HUE needs permission', 'Open HUE to review the request.'],
		clarify: ['HUE needs your input', 'Open HUE to answer safely.'],
		failed: ['Task failed', 'Open HUE to inspect the failure.'],
		unknown: ['Task outcome unknown', 'Open HUE to inspect delivery state.']
	}[kind];
	return {
		id: `notification:${index}`,
		projectId: null,
		sessionId: 'session-1',
		kind,
		priority: kind === 'completed' ? 'normal' : 'high',
		title: copy[0],
		body: copy[1],
		path: `/?project=none&session=session-1&event=${index}`,
		createdAt: new Date(Date.UTC(2026, 7, 23, 10, 0, index)).toISOString(),
		readAt: null,
		dismissedAt: null,
		actedAt: null
	};
}

async function mockNotifications(
	page: import('@playwright/test').Page,
	items: Item[],
	options: { listDelayAfterFirst?: number } = {}
) {
	const keys = webPush.generateVAPIDKeys();
	let listRequests = 0;
	await page.route('**/api/notifications**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/notifications/status') {
			return route.fulfill({ json: { available: true, publicKey: keys.publicKey, reason: null } });
		}
		if (url.pathname === '/api/notifications/endpoints') {
			if (route.request().method() === 'GET') return route.fulfill({ json: { endpoints: [] } });
			return route.fulfill({
				json: {
					id: 'endpoint:test',
					deviceId: 'device',
					name: 'This device',
					enabled: true,
					revokedAt: null
				}
			});
		}
		if (url.pathname === '/api/notifications/presence') return route.fulfill({ status: 204 });
		if (url.pathname === '/api/notifications') {
			if (route.request().method() === 'PATCH') {
				const now = new Date().toISOString();
				let updated = 0;
				for (const item of items) {
					if (!item.readAt && !item.dismissedAt) {
						item.readAt = now;
						updated += 1;
					}
				}
				return route.fulfill({
					json: { updated, counts: { unread: 0, all: items.length } }
				});
			}
			listRequests += 1;
			if (listRequests > 1 && options.listDelayAfterFirst)
				await new Promise((resolve) => setTimeout(resolve, options.listDelayAfterFirst));
			const visible =
				url.searchParams.get('view') === 'all'
					? items
					: items.filter(({ readAt, dismissedAt }) => !readAt && !dismissedAt);
			return route.fulfill({
				json: {
					items: visible.toSorted((a, b) => b.id.localeCompare(a.id)),
					nextCursor: null,
					counts: {
						unread: items.filter(({ readAt, dismissedAt }) => !readAt && !dismissedAt).length,
						all: items.length
					}
				}
			});
		}
		const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
		const current = items.find((candidate) => candidate.id === id);
		if (current && route.request().method() === 'PATCH') {
			const { state } = (await route.request().postDataJSON()) as { state: string };
			const now = new Date().toISOString();
			if (state === 'read') current.readAt = now;
			if (state === 'dismissed') current.dismissedAt = now;
			if (state === 'acted') {
				current.actedAt = now;
				current.readAt ??= now;
			}
			return route.fulfill({ json: current });
		}
		return route.fulfill({ status: 404, json: { error: 'Not found' } });
	});
}

async function mockProjectlessSession(
	page: import('@playwright/test').Page,
	options: {
		events?: Array<{
			sequence: number;
			type: string;
			payload: Record<string, unknown>;
		}>;
		onLoad?: () => void;
	} = {}
) {
	await page.route(/\/api\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-1', cwd: '/private', title: 'Visible session' }] }
		})
	);
	await page.route(/\/api\/sessions\/session-1$/, (route) => {
		options.onLoad?.();
		return route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: options.events ?? [],
				cursor: options.events?.at(-1)?.sequence ?? 0,
				activeTurn: null,
				commands: []
			}
		});
	});
	await page.route(/\/api\/sessions\/session-1\/events.*/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
}

test('attention center is complete responsive fallback for all five kinds exactly once', async ({
	page
}) => {
	test.setTimeout(60_000);
	const items = (['completed', 'permission', 'clarify', 'failed', 'unknown'] as const).map(item);
	await mockNotifications(page, items);
	await page.goto('/');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.getByRole('button', { name: /Notifications/ }).click();
		await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
		await expect(page.locator('li')).toHaveCount(5);
		for (const kind of [
			'Task completed',
			'HUE needs permission',
			'HUE needs your input',
			'Task failed',
			'Task outcome unknown'
		]) {
			await expect(page.getByText(kind, { exact: true })).toHaveCount(1);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			for (const button of await page
				.getByRole('region', { name: 'Notifications' })
				.getByRole('button')
				.all()) {
				if (await button.isVisible())
					expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			}
		}
		await page.getByRole('button', { name: 'Back to workspace' }).click();
	}

	await page.getByRole('button', { name: /Notifications/ }).click();
	await page
		.locator('li')
		.filter({ hasText: 'Task completed' })
		.getByRole('button', { name: 'Mark Task completed read' })
		.click();
	await expect(page.locator('li')).toHaveCount(4);
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect(page.locator('li')).toHaveCount(5);
	await page
		.locator('li')
		.filter({ hasText: 'Task failed' })
		.getByRole('button', { name: 'Dismiss Task failed' })
		.click();
	await expect(page.locator('li')).toHaveCount(5);
	const link = page.getByRole('link', { name: 'HUE needs your input' });
	await expect(link).toHaveAttribute('href', '/?project=none&session=session-1&event=2');
});

test('notification click acknowledges before focusing its exact actionable request', async ({
	page
}) => {
	const items = [item('permission', 7)];
	let actedBeforeSessionLoad = false;
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await mockNotifications(page, items);
	await mockProjectlessSession(page, {
		events: [
			{
				sequence: 7,
				type: 'agent.permission',
				payload: {
					messageId: 'message-1',
					id: 'permission-1',
					status: 'pending',
					toolCall: { title: 'Run checks', args: { command: 'bun test' } },
					options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
				}
			}
		],
		onLoad: () => (actedBeforeSessionLoad = Boolean(items[0]?.actedAt))
	});
	await page.goto('/');
	await page.getByRole('button', { name: /Notifications/ }).click();

	const link = page.getByRole('link', { name: 'HUE needs permission' });
	expect(
		await link.evaluate((element) => {
			const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
			return { allowed: element.dispatchEvent(event), defaultPrevented: event.defaultPrevented };
		})
	).toEqual({ allowed: true, defaultPrevented: false });
	await expect.poll(() => items[0]?.actedAt).not.toBeNull();
	items[0]!.readAt = null;
	items[0]!.actedAt = null;
	await link.click();

	await expect(page.getByRole('button', { name: 'Allow once' })).toBeFocused();
	await expect(page.getByRole('group', { name: 'Permission required: Run checks' })).toHaveClass(
		/notification-target/
	);
	expect(actedBeforeSessionLoad).toBe(true);
	await expect.poll(() => new URL(page.url()).searchParams.has('event')).toBe(false);
	expect(browserErrors).toEqual([]);
});

test('completed notification focuses the corresponding result message', async ({
	page
}, testInfo) => {
	const items = [item('completed', 9)];
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await mockNotifications(page, items);
	await mockProjectlessSession(page, {
		events: [
			{
				sequence: 8,
				type: 'agent.chunk',
				payload: { messageId: 'message-9', text: 'Exact completed result' }
			},
			{
				sequence: 9,
				type: 'message.completed',
				payload: { messageId: 'message-9' }
			}
		]
	});
	for (const [index, viewport] of viewports.entries()) {
		items[0]!.readAt = null;
		items[0]!.actedAt = null;
		await page.setViewportSize(viewport);
		if (index === 0) await page.goto('/');
		const result = page.locator('[data-message-id="message-9"]');
		await page.getByRole('button', { name: /Notifications/ }).click();
		await page.getByRole('link', { name: 'Task completed' }).click();

		await expect(result, `${viewport.width}x${viewport.height} result focus`).toBeFocused();
		await expect(result).toHaveClass(/notification-target/);
		await expect(result).toContainText('Exact completed result');
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`notification-target-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}
	expect(browserErrors).toEqual([]);
});

test('marks every notification read from the panel', async ({ page }) => {
	const items = [item('completed', 1), item('failed', 2), item('clarify', 3)];
	await mockNotifications(page, items);
	await page.goto('/');
	await page.getByRole('button', { name: /Notifications/ }).click();

	await page.getByRole('button', { name: 'Mark all read' }).click();

	await expect(page.getByText('No notifications')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect(page.locator('li')).toHaveCount(3);
	await expect(page.getByRole('button', { name: 'Mark read' })).toHaveCount(0);
});

test('groups only matching current permission notifications and preserves secondary actions', async ({
	page
}) => {
	let sessionLoads = 0;
	const first = item('permission', 1);
	const duplicate = {
		...item('permission', 2),
		projectId: 'project-1',
		interactionId: 'permission-1',
		currentRelevant: true
	};
	Object.assign(first, {
		projectId: 'project-1',
		interactionId: 'permission-1',
		currentRelevant: true
	});
	const differentSession = {
		...item('permission', 3),
		projectId: 'project-1',
		sessionId: 'session-2',
		interactionId: 'permission-1',
		currentRelevant: true
	};
	const stale = {
		...item('permission', 4),
		projectId: 'project-1',
		interactionId: 'permission-1',
		currentRelevant: false
	};
	await mockNotifications(page, [first, duplicate, differentSession, stale]);
	await mockProjectlessSession(page, {
		events: [
			{
				sequence: 2,
				type: 'agent.permission',
				payload: {
					messageId: 'message-1',
					id: 'permission-1',
					status: 'pending',
					toolCall: { title: 'Run checks', args: { command: 'bun test' } },
					options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
				}
			}
		],
		onLoad: () => (sessionLoads += 1)
	});
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/');
	await page.getByRole('button', { name: /Notifications/ }).click();

	await expect(page.getByText('2 pending requests')).toHaveCount(1);
	await expect(page.locator('li')).toHaveCount(3);
	const grouped = page.locator('li').filter({ hasText: '2 pending requests' });
	await expect(grouped.getByRole('link', { name: 'HUE needs permission' })).toHaveCount(1);
	await expect(grouped.getByRole('button', { name: 'Mark 2 notifications read' })).toBeVisible();
	await expect(grouped.getByRole('button', { name: 'Dismiss 2 notifications' })).toBeVisible();
	await expectMinimumTouchTargets(grouped.getByRole('button'));
	await grouped.getByRole('link', { name: 'HUE needs permission' }).click();
	await expect.poll(() => [first.actedAt, duplicate.actedAt]).not.toContain(null);
	await expect(page.getByRole('button', { name: 'Allow once' })).toBeFocused();
	expect(sessionLoads).toBe(1);
});

test('background notification polling keeps the current list visible', async ({ page }) => {
	const items = [item('completed', 1)];
	await mockNotifications(page, items, { listDelayAfterFirst: 2_000 });
	await page.goto('/');
	await page.getByRole('button', { name: /Notifications/ }).click();
	await expect(page.getByText('Task completed', { exact: true })).toBeVisible();
	await page.evaluate(() => {
		(window as Window & { __notificationLoadingSeen?: boolean }).__notificationLoadingSeen = false;
		new MutationObserver(() => {
			if (document.body.textContent?.includes('Loading notifications…'))
				(window as Window & { __notificationLoadingSeen?: boolean }).__notificationLoadingSeen =
					true;
		}).observe(document.body, { childList: true, subtree: true, characterData: true });
	});

	await page.waitForTimeout(7_200);
	await expect(page.getByText('Task completed', { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as Window & { __notificationLoadingSeen?: boolean }).__notificationLoadingSeen
		)
	).toBe(false);
});

test('permission is requested on button gesture and exact visible context suppresses routine foreground alert', async ({
	page
}) => {
	test.setTimeout(60_000);
	const items: Item[] = [];
	await mockNotifications(page, items);
	await mockProjectlessSession(page);
	await page.addInitScript(() => {
		localStorage.setItem('hue:notification:foreground', 'true');
		(window as Window & { __shown?: string[]; __permissionCalls?: number }).__shown = [];
		(window as Window & { __shown?: string[]; __permissionCalls?: number }).__permissionCalls = 0;
		class MockNotification {
			static permission: NotificationPermission = 'default';
			static async requestPermission() {
				(window as Window & { __permissionCalls?: number }).__permissionCalls! += 1;
				MockNotification.permission = 'granted';
				return 'granted' as NotificationPermission;
			}
			onclick: (() => void) | null = null;
			constructor(title: string) {
				(window as Window & { __shown?: string[] }).__shown!.push(title);
			}
		}
		Object.defineProperty(window, 'Notification', { value: MockNotification });
	});
	await page.goto('/?project=none&session=session-1');
	await expect(page.getByRole('heading', { name: 'Visible session' })).toBeVisible();
	await page.getByRole('button', { name: /Notifications/ }).click();
	await page.getByRole('button', { name: 'Notification settings' }).click();
	await page.getByRole('button', { name: 'Enable system notifications' }).click();
	await expect
		.poll(() =>
			page.evaluate(() => (window as Window & { __permissionCalls?: number }).__permissionCalls)
		)
		.toBe(1);
	await page.getByRole('button', { name: 'Back to workspace' }).click();

	items.push(item('completed', 1));
	await page.waitForTimeout(5_500);
	expect(await page.evaluate(() => (window as Window & { __shown?: string[] }).__shown)).toEqual(
		[]
	);
	items.push(item('permission', 2));
	await expect
		.poll(() => page.evaluate(() => (window as Window & { __shown?: string[] }).__shown), {
			timeout: 7_000
		})
		.toEqual(['HUE needs permission']);
});
