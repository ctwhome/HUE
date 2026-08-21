import { expect, test } from '@playwright/test';

async function expectMinimumTouchTargets(locator: import('@playwright/test').Locator) {
	for (let index = 0; index < (await locator.count()); index += 1) {
		const target = locator.nth(index);
		if (await target.isVisible()) {
			expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
	}
}

async function addProject(page: import('@playwright/test').Page) {
	await page.goto('/');
	const projectsMenu = page.locator('.mobile-navigation').getByRole('button', { name: 'Projects' });
	if (await projectsMenu.isVisible()) await projectsMenu.click();
	const existing = page
		.locator('.project-rail nav')
		.getByRole('button', { name: 'HUE', includeHidden: true });
	if (await existing.count()) {
		await existing.click();
		return;
	}
	const response = await page.request.post('/api/projects', {
		data: { name: 'HUE', rootPath: process.env.HUE_E2E_PROJECT_ROOT ?? process.cwd() }
	});
	if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
	await page.goto('/');
	if (await projectsMenu.isVisible()) await projectsMenu.click();
	await page.locator('.project-rail nav').getByRole('button', { name: 'HUE' }).click();
}

test('opens project creation from the Projects heading and dismisses it with Escape', async ({
	page
}) => {
	const browserErrors: string[] = [];
	let submittedProject: { name: string; rootPath: string } | undefined;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route(/\/api\/directories/, (route) => {
		const url = new URL(route.request().url());
		const requestedPath = url.searchParams.get('path');
		const path = requestedPath || '/Users/example';
		return route.fulfill({
			json: {
				path,
				name: path.split('/').pop(),
				parent: path === '/Users/example' ? '/Users' : '/Users/example',
				entries:
					path === '/Users/example'
						? [
								...(url.searchParams.get('hidden') === 'true'
									? [{ name: '.config', path: `${path}/.config` }]
									: []),
								{ name: 'Documents', path: `${path}/Documents` }
							]
						: []
			}
		});
	});
	await page.route('/api/projects', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		submittedProject = (await route.request().postDataJSON()) as typeof submittedProject;
		return route.fulfill({
			status: 201,
			json: { project: { id: 'picked-project', ...submittedProject } }
		});
	});
	await page.route(/\/api\/projects\/picked-project\/sessions$/, (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
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
		await dialog.getByRole('button', { name: 'Documents' }).click();
		await expect(dialog.getByText('/Users/example/Documents', { exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Parent directory' }).click();
		await dialog.getByLabel('Show hidden').check();
		await expect(dialog.getByRole('button', { name: '.config' })).toBeVisible();
		if (viewport.width <= 700)
			expect((await addButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		if (viewport.width === 1440) {
			await addButton.click();
			await dialog.getByRole('button', { name: 'Add this directory' }).click();
			await expect(dialog).toBeHidden();
			expect(submittedProject).toEqual({ name: 'example', rootPath: '/Users/example' });
		}
	}
	expect(browserErrors).toEqual([]);
});

test('inspects the active Hermes runtime without exposing unsupported administration', async ({
	page
}) => {
	await page.route('/api/hermes', (route) =>
		route.fulfill({
			json: {
				profile: 'work',
				protocolVersion: 1,
				agent: { name: 'hermes-agent', version: '0.2.0' },
				capabilities: { loadSession: true }
			}
		})
	);

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		const globalRail = page.getByRole('navigation', { name: 'Global navigation' });
		const projectsMenu = page.getByRole('button', { name: 'Projects', exact: true });
		if (viewport.width > 700) {
			await expect(globalRail).toBeVisible();
			const railBox = (await globalRail.boundingBox())!;
			const projectsBox = (await page.locator('#project-drawer').boundingBox())!;
			expect(railBox.width).toBeLessThanOrEqual(64);
			expect(projectsBox.x).toBe(railBox.width);
		} else {
			await expect(globalRail).toBeHidden();
			await expect(page.getByRole('button', { name: 'Inspect Hermes runtime' })).toBeVisible();
		}
		await page.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
		const dialog = page.getByRole('dialog', { name: 'Hermes runtime' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('work', { exact: true })).toBeVisible();
		await expect(dialog.getByText('hermes-agent 0.2.0')).toBeVisible();
		await expect(dialog.getByText('Skills are not exposed by Hermes ACP')).toBeVisible();
		await expect(dialog.getByText('Schedules are not exposed by Hermes ACP')).toBeVisible();
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(dialog.locator('.icon-button, summary'));
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	}
});

test('keeps the newest Hermes inspector response after closing and reopening', async ({ page }) => {
	let request = 0;
	let releaseFirst = () => {};
	const firstResponse = new Promise<void>((resolve) => (releaseFirst = resolve));
	await page.route('/api/hermes', async (route) => {
		request += 1;
		if (request === 1) await firstResponse;
		await route.fulfill({
			json: {
				profile: request === 1 ? 'stale' : 'current',
				protocolVersion: 1
			}
		});
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
	const dialog = page.getByRole('dialog', { name: 'Hermes runtime' });
	await expect(dialog.getByText('current', { exact: true })).toBeVisible();
	releaseFirst();
	await expect(dialog.getByText('current', { exact: true })).toBeVisible();
	await expect(dialog.getByText('stale', { exact: true })).toBeHidden();
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
						type: 'agent.thought',
						payload: {
							messageId: captured.envelope?.messageId,
							text: 'Checking the request before answering.'
						}
					},
					{
						sequence: 3,
						type: 'agent.chunk',
						payload: { messageId: captured.envelope?.messageId, text: '**Done** ' }
					},
					{
						sequence: 4,
						type: 'agent.chunk',
						payload: { messageId: captured.envelope?.messageId, text: '`safely`.' }
					}
				]
			}
		});
	});
	await page.route(/\/sessions\/session-send\/events\?after=4$/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 250));
		await route.fulfill({
			json: {
				events: [
					{
						sequence: 5,
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

	await expect(page.getByText('Hermes reasoning')).toBeVisible();
	await expect(page.getByText('Checking the request before answering.')).toBeVisible();
	const assistant = page.locator('.transcript article.assistant');
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	await expect(page.getByText('completed', { exact: true })).toBeVisible();
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	expect(
		await page
			.locator('.transcript')
			.evaluate((element) => getComputedStyle(element, '::after').content)
	).toBe('none');
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

test('keeps the latest user question at the top while its answer grows', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	const transcript = Array.from({ length: 2 }, (_, index) => [
		{ role: 'user', text: `Earlier question ${index}` },
		{ role: 'assistant', text: `Earlier answer ${index} `.repeat(70) }
	]).flat();
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-sticky', cwd: '/work/hue', title: 'Sticky' }] }
		})
	);
	await page.route(/\/sessions\/session-sticky$/, (route) =>
		route.fulfill({
			json: { transcript, messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route(/\/sessions\/session-sticky\/messages$/, (route) =>
		route.fulfill({ status: 202, json: { status: 'queued' } })
	);
	await page.route(/\/sessions\/session-sticky\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await addProject(page);
		await page.getByRole('button', { name: /Sticky/ }).click();
		const scroller = page.locator('.transcript');
		const loadedQuestion = scroller.locator('article.user').last();
		const loadedStickyTop =
			(await scroller.boundingBox())!.y +
			(await scroller.evaluate((element) =>
				Number.parseFloat(getComputedStyle(element).paddingTop)
			));
		await expect
			.poll(
				async () => Math.abs((await loadedQuestion.boundingBox())!.y - loadedStickyTop),
				{ message: `${viewport.width}x${viewport.height}` }
			)
			.toBeLessThan(2);
		await page.getByLabel('Message Hermes').fill('Keep this question visible');
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		const latestQuestion = scroller.locator('article.user').last();
		await expect(latestQuestion).toBeVisible();
		const stickyTop =
			(await scroller.boundingBox())!.y +
			(await scroller.evaluate((element) =>
				Number.parseFloat(getComputedStyle(element).paddingTop)
			));
		await expect
			.poll(async () => Math.abs((await latestQuestion.boundingBox())!.y - stickyTop))
			.toBeLessThan(2);
		await scroller.evaluate((element) => (element.scrollTop += 200));
		expect(Math.abs((await latestQuestion.boundingBox())!.y - stickyTop)).toBeLessThan(2);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('shows a live timer beside each busy session', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	const busySince = new Date(Date.now() - 50_000).toISOString();
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'session-busy', cwd: '/work/hue', title: 'Working session', busySince }
				]
			}
		})
	);

	await addProject(page);
	const timer = page.locator('.busy-timer');
	await expect(timer).toHaveText(/5\ds/);
	const initial = await timer.textContent();
	await expect.poll(() => timer.textContent()).not.toBe(initial);

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		if (!(await timer.isVisible())) {
			await page.getByRole('button', { name: 'Sessions', exact: true }).click();
		}
		await expect(timer).toBeVisible();
		await expect(timer).toHaveAttribute('aria-label', /Busy for /);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('discovers Hermes slash commands and sends an attached image', async ({ page }) => {
	let envelope: { text: string; images: Array<{ name: string; mimeType: string; data: string }> };
	let selectedModel = '';
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-rich', cwd: '/work/hue', title: 'Rich input' }] }
		})
	);
	await page.route(/\/sessions\/session-rich$/, async (route) => {
		if (route.request().method() === 'PATCH') {
			selectedModel = ((await route.request().postDataJSON()) as { modelId: string }).modelId;
			return route.fulfill({
				json: {
					runtime: {
						profile: 'default',
						models: {
							currentModelId: selectedModel,
							availableModels: [
								{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' },
								{ modelId: 'anthropic:claude', name: 'Claude' }
							]
						}
					}
				}
			});
		}
		return route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				branch: 'main',
				runtime: {
					profile: 'default',
					models: {
						currentModelId: 'openai:gpt-5.6',
						availableModels: [
							{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' },
							{ modelId: 'anthropic:claude', name: 'Claude' }
						]
					},
					modes: {
						currentModeId: 'default',
						availableModes: [{ id: 'default', name: 'Default' }]
					},
					usage: { used: 32_000, size: 128_000 }
				},
				commands: [
					{ name: 'help', description: 'List available commands' },
					{ name: 'compress', description: 'Compress conversation context' }
				]
			}
		});
	});
	await page.route(/\/sessions\/session-rich\/messages$/, async (route) => {
		envelope = (await route.request().postDataJSON()) as typeof envelope;
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/session-rich\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await page.getByRole('button', { name: /Rich input/ }).click();
	await expect(page.getByText('default', { exact: true })).toBeVisible();
	await expect(page.getByText('main', { exact: true })).toBeVisible();
	await expect(page.getByText('25%', { exact: true })).toBeVisible();
	await page.getByLabel('Hermes model').selectOption('anthropic:claude');
	await expect.poll(() => selectedModel).toBe('anthropic:claude');
	await page.getByLabel('Message Hermes').fill('/');
	await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toBeVisible();
	await expect(page.getByRole('option', { name: /compress/ })).toContainText(
		'Compress conversation context'
	);
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toBeVisible();
		await expect(page.getByLabel('Hermes model')).toBeVisible();
		await expect(page.getByText('main', { exact: true })).toBeVisible();
		await expect(page.getByText('25%', { exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(page.getByRole('option'));
			await expectMinimumTouchTargets(page.locator('.composer-context .context-chip'));
		}
	}
	await page.getByRole('option', { name: /compress/ }).click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('/compress ');

	await page.getByLabel('Attach images').setInputFiles({
		name: 'screen.png',
		mimeType: 'image/png',
		buffer: Buffer.from('image bytes')
	});
	await expect(page.getByRole('img', { name: 'screen.png' })).toBeVisible();
	await page.getByLabel('Message Hermes').fill('Review this screenshot');
	await page.getByLabel('Message Hermes').press('Enter');

	expect(envelope!.text).toBe('Review this screenshot');
	expect(envelope!.images[0]).toMatchObject({ name: 'screen.png', mimeType: 'image/png' });
	expect(Buffer.from(envelope!.images[0].data, 'base64').toString()).toBe('image bytes');
	expect(browserErrors).toEqual([]);
});

test('queues and edits messages while streaming, then can send now or stop', async ({ page }) => {
	let queued: { messageId: string; text: string } | null = null;
	let edited = '';
	let cancellations = 0;
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-queue', cwd: '/work/hue', title: 'Queue' }] }
		})
	);
	await page.route(/\/sessions\/session-queue$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'user', text: 'Current task' }],
				messages: [{ id: 'active', status: 'running', text: 'Current task', images: [] }],
				events: [],
				cursor: 0,
				activeTurn: {
					messageId: 'active',
					status: 'running',
					thought: 'Thinking',
					output: 'Working',
					error: null
				},
				runtime: { profile: 'default' }
			}
		})
	);
	await page.route(/\/sessions\/session-queue\/messages$/, async (route) => {
		const body = (await route.request().postDataJSON()) as { messageId: string; text: string };
		if (route.request().method() === 'PATCH') {
			edited = body.text;
			return route.fulfill({ json: { message: { ...queued, text: edited, status: 'queued' } } });
		}
		queued = body;
		return route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/session-queue\/cancel$/, (route) => {
		cancellations += 1;
		return route.fulfill({ status: 202, json: { cancelled: true } });
	});
	await page.route(/\/sessions\/session-queue\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await page.getByRole('button', { name: /Queue/ }).click();
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByLabel('Message Hermes').fill('Follow up');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect(page.getByRole('region', { name: 'Queued messages' })).toContainText('Follow up');
	await page.getByRole('button', { name: 'Edit queued message' }).click();
	await page.getByLabel('Message Hermes').fill('Edited follow up');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect.poll(() => edited).toBe('Edited follow up');
	await page.getByRole('button', { name: 'Send queued message now' }).click();
	await expect.poll(() => cancellations).toBe(1);
});

test('shows durable delegate_task children as a collapsible status and result tree', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-agents', cwd: '/work/hue', title: 'Agents' }] }
		})
	);
	await page.route(/\/sessions\/session-agents$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'user', text: 'Move the project' }],
				messages: [{ id: 'msg-1', status: 'completed' }],
				events: [
					{
						sequence: 2,
						type: 'agent.subagents',
						payload: {
							messageId: 'msg-1',
							id: 'delegate-1',
							title: '2 subagents',
							status: 'completed',
							children: [
								{
									index: 0,
									goal: 'Map moved path references',
									role: 'explore',
									status: 'completed',
									result: 'Found three references.'
								},
								{
									index: 1,
									goal: 'Trace Astro move paths',
									role: 'reviewer',
									status: 'failed',
									result: 'Astro config was missing.'
								}
							]
						}
					}
				],
				cursor: 2,
				activeTurn: null
			}
		})
	);

	await addProject(page);
	await page.getByRole('button', { name: /Agents/ }).click();
	const tree = page.getByRole('group', { name: '2 subagents' });
	await expect(tree).toBeVisible();
	await expect(tree.getByText('Map moved path references')).toBeVisible();
	await expect(tree.getByText('failed', { exact: true })).toBeVisible();
	await expect(tree.getByText('Found three references.')).toBeHidden();
	await tree.getByText('Map moved path references').click();
	await expect(tree.getByText('Found three references.')).toBeVisible();
	await tree.getByText('2 subagents', { exact: true }).click();
	await expect(tree.getByText('Map moved path references')).toBeHidden();

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(tree.locator('summary'));
	}
	expect(browserErrors).toEqual([]);
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

test('starts a new session without the previous session output', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 201,
				json: { session: { sessionId: 'session-new', cwd: '/work/hue' }, commands: [] }
			});
			return;
		}
		await route.fulfill({
			json: { sessions: [{ sessionId: 'session-old', cwd: '/work/hue', title: 'Old' }] }
		});
	});
	await page.route(/\/sessions\/session-old$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: {
					messageId: 'old-message',
					status: 'unknown',
					output: 'Previous session wall of text',
					error: null
				}
			}
		})
	);

	await addProject(page);
	await page.getByRole('button', { name: /Old/ }).click();
	await expect(page.getByText('Previous session wall of text')).toBeVisible();
	await page.getByRole('button', { name: 'New session', exact: true }).click();

	await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
	await expect(page.getByText('Previous session wall of text')).toBeHidden();
	await expect(page.getByText('delivery unknown', { exact: true })).toBeHidden();
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width === 320) {
			await expectMinimumTouchTargets(page.locator('.composer textarea, .composer button'));
		}
	}
	expect(browserErrors).toEqual([]);
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
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();

	await page.getByRole('button', { name: /Another/ }).click();
	await page.getByLabel('Message Hermes').fill('Unsent local draft');
	await page.getByRole('button', { name: /Main/ }).click();
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();

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
		await expect(page.getByLabel('Message Hermes')).toBeEnabled();
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
