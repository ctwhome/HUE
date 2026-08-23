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
};

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
		path: '/?project=none&session=session-1',
		createdAt: new Date(Date.UTC(2026, 7, 23, 10, 0, index)).toISOString(),
		readAt: null,
		dismissedAt: null,
		actedAt: null
	};
}

async function mockNotifications(page: import('@playwright/test').Page, items: Item[]) {
	const keys = webPush.generateVAPIDKeys();
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
			if (state === 'acted') current.actedAt = now;
			return route.fulfill({ json: current });
		}
		return route.fulfill({ status: 404, json: { error: 'Not found' } });
	});
}

async function mockProjectlessSession(page: import('@playwright/test').Page) {
	await page.route(/\/api\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-1', cwd: '/private', title: 'Visible session' }] }
		})
	);
	await page.route(/\/api\/sessions\/session-1$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null, commands: [] }
		})
	);
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
		.getByRole('button', { name: 'Mark read' })
		.click();
	await expect(page.locator('li')).toHaveCount(4);
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect(page.locator('li')).toHaveCount(5);
	await page
		.locator('li')
		.filter({ hasText: 'Task failed' })
		.getByRole('button', { name: 'Dismiss' })
		.click();
	await expect(page.locator('li')).toHaveCount(5);
	const link = page.getByRole('link', { name: 'HUE needs your input' });
	await expect(link).toHaveAttribute('href', '/?project=none&session=session-1');
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
