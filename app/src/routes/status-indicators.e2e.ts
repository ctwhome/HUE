import { expect, test } from '@playwright/test';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 568 }
];

test('keeps Project and Session status visible while switching panes', async ({ page }) => {
	const created = await page.request.post('/api/projects', {
		data: { name: 'Status project', folders: [process.cwd()], primaryPath: process.cwd() }
	});
	expect(created.ok(), await created.text()).toBe(true);
	const project = (await created.json()).project as { id: string };
	let markedRead = false;

	await page.route('**/api/notifications?**', (route) =>
		route.fulfill({
			json: {
				items: [],
				nextCursor: null,
				counts: { unread: 2, all: 2 },
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
			if ((await page.locator('#session-drawer').getAttribute('aria-hidden')) === 'true')
				await page.getByRole('button', { name: 'Back to Sessions' }).click();
		} else {
			await expect(page.getByLabel('1 running Sessions')).toBeVisible();
			await expect(page.getByLabel('2 unread Sessions')).toBeVisible();
		}
		await expect(page.getByLabel('Unread activity')).toBeVisible();
		await expect(page.getByRole('button', { name: /Running work, Running/ })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}

	await page.getByRole('button', { name: /Finished work, Idle/ }).click();
	await expect.poll(() => markedRead).toBe(true);
	await expect(page.getByLabel('Unread activity')).toHaveCount(0);
});
