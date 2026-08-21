import { expect, test } from '@playwright/test';

async function expectMinimumTouchTargets(locator: import('@playwright/test').Locator) {
	for (let index = 0; index < (await locator.count()); index += 1) {
		expect((await locator.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
	}
}

async function addProject(page: import('@playwright/test').Page) {
	await page.goto('/');
	const projectsMenu = page.locator('.mobile-navigation').getByRole('button', { name: 'Projects' });
	if (await projectsMenu.isVisible()) await projectsMenu.click();
	const existing = page.locator('.project-rail nav').getByRole('button', { name: 'HUE' });
	if (await existing.count()) {
		await existing.click();
		return;
	}
	const response = await page.request.post('/api/projects', {
		data: { name: 'HUE', rootPath: process.env.HUE_E2E_PROJECT_ROOT ?? process.cwd() }
	});
	expect(response.ok()).toBe(true);
	await page.goto('/');
	await page.locator('.project-rail nav').getByRole('button', { name: 'HUE' }).click();
}

test('opens project creation from the Projects heading and dismisses it with Escape', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route(/\/api\/directories/, (route) => {
		const requestedPath = new URL(route.request().url()).searchParams.get('path');
		const path = requestedPath || '/Users/example';
		return route.fulfill({
			json: {
				path,
				name: path.split('/').pop(),
				parent: path === '/Users/example' ? '/Users' : '/Users/example',
				entries: path === '/Users/example' ? [{ name: 'Documents', path: `${path}/Documents` }] : []
			}
		});
	});
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		const projectsMenu = page
			.locator('.mobile-navigation')
			.getByRole('button', { name: 'Projects' });
		if (await projectsMenu.isVisible()) await projectsMenu.click();
		const dialog = page.getByRole('dialog', { name: 'Add project directory' });
		const addButton = page.locator('.section-heading').getByRole('button', { name: 'Add project' });
		await expect(dialog).toBeHidden();
		await addButton.click();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Documents' })).toBeFocused();
		await expect(dialog.getByText('/Users/example', { exact: true })).toBeVisible();
		const dialogBox = await dialog.boundingBox();
		expect(Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport.width / 2)).toBeLessThan(2);
		expect(Math.abs(dialogBox!.y + dialogBox!.height / 2 - viewport.height / 2)).toBeLessThan(2);
		if (viewport.width <= 700)
			expect((await addButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	}
	expect(browserErrors).toEqual([]);
});

test('sends one complete envelope and renders streamed completion', async ({ page }) => {
	const captured: { envelope?: { messageId: string; text: string } } = {};
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		await route.fulfill({
			json: { sessions: [{ sessionId: 'session-send', cwd: '/work/hue', title: 'Send' }] }
		});
	});
	await page.route(/\/sessions\/session-send$/, async (route) => {
		await route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});
	await page.route(/\/sessions\/session-send\/messages$/, async (route) => {
		captured.envelope = (await route.request().postDataJSON()) as {
			messageId: string;
			text: string;
		};
		await route.fulfill({
			status: 202,
			json: { messageId: captured.envelope.messageId, status: 'queued' }
		});
	});
	await page.route(/\/sessions\/session-send\/events\?after=0$/, async (route) => {
		await route.fulfill({
			json: {
				events: [
					{
						sequence: 1,
						type: 'message.running',
						payload: { messageId: captured.envelope?.messageId }
					},
					{
						sequence: 2,
						type: 'agent.chunk',
						payload: { messageId: captured.envelope?.messageId, text: '**Done** ' }
					},
					{
						sequence: 3,
						type: 'agent.chunk',
						payload: { messageId: captured.envelope?.messageId, text: '`safely`.' }
					}
				]
			}
		});
	});
	await page.route(/\/sessions\/session-send\/events\?after=3$/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 250));
		await route.fulfill({
			json: {
				events: [
					{
						sequence: 4,
						type: 'message.completed',
						payload: { messageId: captured.envelope?.messageId }
					}
				]
			}
		});
	});

	await addProject(page);
	await page.getByRole('button', { name: /Send/ }).click();
	const text = 'Complete message 🧭 with final words intact.';
	await page.getByLabel('Message Hermes').fill(text);
	await page.getByRole('button', { name: 'Send', exact: true }).click();

	const assistant = page.locator('.transcript article.assistant');
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	await expect(page.getByText('completed', { exact: true })).toBeVisible();
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await expect(assistant.locator('strong')).toBeVisible();
		if (viewport.width === 320) {
			await expectMinimumTouchTargets(page.locator('.composer textarea, .composer button'));
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(captured.envelope?.text).toBe(text);
	await expect(page.getByLabel('Message Hermes')).toHaveValue('');
});

test('discovers Hermes slash commands and sends an attached image', async ({ page }) => {
	let envelope: { text: string; images: Array<{ name: string; mimeType: string; data: string }> };
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-rich', cwd: '/work/hue', title: 'Rich input' }] }
		})
	);
	await page.route(/\/sessions\/session-rich$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				commands: [
					{ name: 'help', description: 'List available commands' },
					{ name: 'compress', description: 'Compress conversation context' }
				]
			}
		})
	);
	await page.route(/\/sessions\/session-rich\/messages$/, async (route) => {
		envelope = (await route.request().postDataJSON()) as typeof envelope;
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/session-rich\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await page.getByRole('button', { name: /Rich input/ }).click();
	await page.getByLabel('Message Hermes').fill('/');
	await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toBeVisible();
	await expect(page.getByRole('option', { name: /compress/ })).toContainText(
		'Compress conversation context'
	);
	await page.getByRole('option', { name: /compress/ }).click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('/compress ');

	await page.getByLabel('Attach images').setInputFiles({
		name: 'screen.png',
		mimeType: 'image/png',
		buffer: Buffer.from('image bytes')
	});
	await expect(page.getByRole('img', { name: 'screen.png' })).toBeVisible();
	await page.getByLabel('Message Hermes').fill('Review this screenshot');
	await page.getByRole('button', { name: 'Send', exact: true }).click();

	expect(envelope!.text).toBe('Review this screenshot');
	expect(envelope!.images[0]).toMatchObject({ name: 'screen.png', mimeType: 'image/png' });
	expect(Buffer.from(envelope!.images[0].data, 'base64').toString()).toBe('image bytes');
});

test('shows loading beside new session without shifting the session list', async ({ page }) => {
	let finishSessionLoad = () => {};
	let sessionLoad = Promise.resolve();
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				json: { sessions: [{ sessionId: 'session-loading', cwd: '/work/hue', title: 'Loading' }] }
			});
		} else {
			await route.continue();
		}
	});
	await page.route(/\/sessions\/session-loading$/, async (route) => {
		await sessionLoad;
		await route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		sessionLoad = new Promise<void>((resolve) => (finishSessionLoad = resolve));
		await page.setViewportSize(viewport);
		await addProject(page);
		const session = page.getByRole('button', { name: /Loading/ });
		await expect(session).toBeVisible();
		const before = await session.boundingBox();
		await session.click();

		const indicator = page.getByRole('status', { name: 'Loading project contents' });
		await expect(indicator).toBeVisible();
		const during = await session.boundingBox();
		const addButton = await page
			.getByRole('button', { name: 'New session', exact: true })
			.boundingBox();
		const indicatorBox = await indicator.boundingBox();
		expect(during?.y).toBe(before?.y);
		expect(indicatorBox!.x).toBeLessThan(addButton!.x);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);

		finishSessionLoad();
		await expect(indicator).toBeHidden();
		expect((await session.boundingBox())?.y).toBe(before?.y);
	}
});

test('retries a lost acknowledgement with the same complete envelope', async ({ page }) => {
	const serverEnvelopes: Array<{ messageId: string; text: string }> = [];
	let sessionLoads = 0;
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		await route.fulfill({
			json: { sessions: [{ sessionId: 'session-retry', cwd: '/work/hue', title: 'Retry' }] }
		});
	});
	await page.route(/\/sessions\/session-retry$/, async (route) => {
		sessionLoads += 1;
		await route.fulfill({
			json:
				sessionLoads === 1
					? { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
					: {
							transcript: [
								{ role: 'user', text: 'Execute this exactly once.' },
								{ role: 'assistant', text: 'Finished once.' }
							],
							messages: [{ id: serverEnvelopes[0].messageId, status: 'completed' }],
							events: [],
							cursor: 4,
							activeTurn: null
						}
		});
	});
	await page.route(/\/sessions\/session-retry\/messages$/, async (route) => {
		const envelope = (await route.request().postDataJSON()) as { messageId: string; text: string };
		serverEnvelopes.push(envelope);
		if (serverEnvelopes.length === 1) await route.abort('connectionreset');
		else
			await route.fulfill({
				status: 202,
				json: { messageId: envelope.messageId, duplicate: true, status: 'completed' }
			});
	});
	await page.route(/\/sessions\/session-retry\/events\?after=0$/, async (route) => {
		await route.fulfill({ json: { events: [] } });
	});

	await addProject(page);
	await page.getByRole('button', { name: /Retry/ }).click();
	await page.getByLabel('Message Hermes').fill('Execute this exactly once.');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('delivery unknown', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Execute this exactly once.');
	await page.getByRole('button', { name: 'Retry exact message' }).click();

	expect(serverEnvelopes).toHaveLength(2);
	expect(serverEnvelopes[1]).toEqual(serverEnvelopes[0]);
	await expect(page.getByText('completed', { exact: true })).toBeVisible();
	await expect(page.getByText('Execute this exactly once.')).toHaveCount(1);
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();
});

async function mockRunningSession(page: import('@playwright/test').Page) {
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				json: {
					sessions: [
						{ sessionId: 'session-1', cwd: '/work/hue', title: 'Main' },
						{ sessionId: 'session-2', cwd: '/work/hue', title: 'Another' }
					]
				}
			});
		} else {
			await route.continue();
		}
	});
	await page.route(/\/api\/projects\/[^/]+\/sessions\/session-1$/, async (route) => {
		await route.fulfill({
			json: {
				transcript: [{ role: 'user', text: 'Build it' }],
				transcriptError: 'Hermes ACP reconnecting',
				messages: [{ id: 'msg-1', status: 'running', text: 'Build it' }],
				events: [
					{ sequence: 3, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'Working…' } }
				],
				cursor: 3,
				activeTurn: { messageId: 'msg-1', status: 'running', output: 'Working…', error: null }
			}
		});
	});
	await page.route(/\/api\/projects\/[^/]+\/sessions\/session-2$/, async (route) => {
		await route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});
	await page.route(/\/events\?after=3$/, async (route) => route.fulfill({ json: { events: [] } }));
}

test('reload restores running turn visibility and session-scoped draft', async ({ page }) => {
	await mockRunningSession(page);
	await addProject(page);
	await page.getByRole('button', { name: /Main/ }).click();
	await expect(page).toHaveURL(/\?project=[^&]+&session=session-1$/);

	await expect(page.getByText('Working…')).toBeVisible();
	await expect(page.getByText('running', { exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('Hermes ACP reconnecting');
	await expect(page.getByLabel('Message Hermes')).toBeDisabled();

	await page.getByRole('button', { name: /Another/ }).click();
	await page.getByLabel('Message Hermes').fill('Unsent local draft');
	await page.getByRole('button', { name: /Main/ }).click();
	await expect(page.getByLabel('Message Hermes')).toBeDisabled();

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.reload();
		await expect(page).toHaveURL(/\?project=[^&]+&session=session-1$/);
		await expect(page.getByText('Working…')).toBeVisible();
		await expect(page.getByLabel('Message Hermes')).toBeDisabled();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByRole('button', { name: /Another/ }).click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Unsent local draft');
});

test('mobile uses explicit exclusive Projects and Sessions drawers', async ({ page }) => {
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);

	const mobileNavigation = page.locator('.mobile-navigation');
	const projects = mobileNavigation.getByRole('button', { name: 'Projects' });
	const sessions = mobileNavigation.getByRole('button', { name: 'Sessions' });
	expect(await page.locator('#project-drawer').count()).toBe(1);
	await expect(projects).toBeHidden();
	await expect(sessions).toBeHidden();
	for (const width of [390, 360, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(projects).toBeVisible();
		await expect(sessions).toBeVisible();
		expect((await projects.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width
		);
	}
	await expect(projects).toBeVisible();
	await expect(sessions).toBeVisible();
	await expectMinimumTouchTargets(mobileNavigation.getByRole('button'));
	await projects.click();
	await expect(projects).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('#project-drawer')).toBeVisible();
	await expect(page.locator('#session-drawer')).toBeHidden();
	await expectMinimumTouchTargets(page.locator('#project-drawer input, #project-drawer button'));
	await sessions.click();
	await expect(projects).toHaveAttribute('aria-expanded', 'false');
	await expect(sessions).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('#project-drawer')).toBeHidden();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expectMinimumTouchTargets(page.locator('#session-drawer button'));
	await page.getByRole('button', { name: 'Workflows' }).click();
	await expectMinimumTouchTargets(
		page.locator('#session-drawer button, #session-drawer input, #session-drawer textarea')
	);
});
