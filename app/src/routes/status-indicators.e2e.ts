import { expect, test } from '@playwright/test';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 568 }
];
const createdProjectIds: string[] = [];

test.afterEach(async ({ request }) => {
	for (const projectId of createdProjectIds.splice(0))
		await request.delete(`/api/projects/${projectId}`);
});

test('keeps Project and Session status visible while switching panes', async ({ page }) => {
	const pageErrors: string[] = [];
	const requestFailures: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (
			request.method() === 'HEAD' &&
			/\/_app\/immutable\/assets\/data\.[^/]+\.json$/.test(request.url())
		)
			return;
		requestFailures.push(`${request.method()} ${request.url()}`);
	});
	const created = await page.request.post('/api/projects', {
		data: { name: 'Status project', folders: [process.cwd()], primaryPath: process.cwd() }
	});
	expect(created.ok(), await created.text()).toBe(true);
	const project = (await created.json()).project as { id: string };
	createdProjectIds.push(project.id);
	let markedRead = false;

	await page.route('**/api/notifications?**', (route) =>
			route.fulfill({
				json: {
					items: [],
					nextCursor: null,
					counts: { unread: 2, all: 2 },
					chatIndicators: { running: 1, attention: 0, unread: 1 },
					projectIndicators: { [project.id]: { running: 1, attention: 0, unread: 2 } }
				}
			})
	);
	await page.route(new RegExp(`/api/projects/${project.id}/sessions(?:\\?.*)?$`), (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'running-session',
						cwd: process.cwd(),
						title: 'Running work',
						status: 'running',
						busySince: new Date().toISOString()
					},
					{
						sessionId: 'finished-session',
						cwd: process.cwd(),
						title: 'Finished work',
						status: null,
						unreadAttention: true
					}
				],
				hasMore: false
			}
		})
	);
	await page.route(`**/api/projects/${project.id}/sessions/finished-session`, async (route) => {
		if (route.request().method() === 'PATCH') {
			markedRead = (await route.request().postDataJSON()).read === true;
			return route.fulfill({ json: { updated: 1 } });
		}
		return route.fulfill({
			json: { transcript: [], cursor: 0, activeTurn: null, events: [], messages: [] }
		});
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto(`/?project=${project.id}`);
		if (viewport.width <= 700) {
			if ((await page.locator('#session-drawer').getAttribute('aria-hidden')) === 'true') {
				await page.getByRole('button', { name: 'Back to Sessions' }).click();
			}
			await page.getByRole('button', { name: 'Back to Projects' }).click();
		}
		const chats = page.locator('.projectless-row').filter({ hasText: 'Chats' });
		await expect(chats.getByLabel('1 running Chat')).toBeVisible();
		await expect(chats.getByLabel('1 unread Chat')).toBeVisible();
		await expect(page.getByLabel('1 running Sessions')).toBeVisible();
		const unreadBadge = page.getByLabel('2 unread Sessions');
		await expect(unreadBadge).toBeVisible();
		await expect(unreadBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
		if (viewport.width <= 700)
			await page.locator('[data-project-id]').filter({ hasText: 'Status project' }).click();
		await expect(page.getByLabel('Unread activity')).toBeVisible();
		await expect(page.getByRole('button', { name: /Running work, Running/ })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}

	await page.getByRole('button', { name: /Finished work, Idle/ }).click();
	await expect.poll(() => markedRead).toBe(true);
	await expect(page.getByLabel('Unread activity')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
	expect(requestFailures).toEqual([]);
});
