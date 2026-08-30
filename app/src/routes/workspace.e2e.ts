import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 568 }
];
const mobileViewports = [
	...viewports.filter(({ width }) => width <= 412),
	{ width: 412, height: 915 }
];

type IdleControlledWindow = Window & { __runHueIdleCallbacks: () => void };

async function controlIdleCallbacks(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		let nextId = 1;
		const callbacks = new Map<number, IdleRequestCallback>();
		window.requestIdleCallback = (callback) => {
			const id = nextId++;
			callbacks.set(id, callback);
			return id;
		};
		window.cancelIdleCallback = (id) => callbacks.delete(id);
		(window as unknown as IdleControlledWindow).__runHueIdleCallbacks = () => {
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 50 });
		};
	});
}

async function runIdleCallbacks(page: import('@playwright/test').Page) {
	await page.evaluate(() => (window as unknown as IdleControlledWindow).__runHueIdleCallbacks());
}

async function expectMinimumTouchTargets(locator: import('@playwright/test').Locator) {
	for (let index = 0; index < (await locator.count()); index += 1) {
		const target = locator.nth(index);
		if (await target.isVisible()) {
			expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
	}
}

async function touchDrag(
	page: import('@playwright/test').Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	during?: () => Promise<void>
) {
	await page.evaluate(({ x, y }) => {
		const target = document.elementFromPoint(x, y);
		if (!target) throw new Error(`No drag target at ${x},${y}`);
		target.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				pointerId: 41,
				pointerType: 'touch',
				isPrimary: true,
				clientX: x,
				clientY: y
			})
		);
	}, from);
	for (let step = 1; step <= 4; step += 1) {
		const point = {
			x: from.x + ((to.x - from.x) * step) / 4,
			y: from.y + ((to.y - from.y) * step) / 4
		};
		await page.waitForTimeout(24);
		await page.evaluate(({ x, y }) => {
			window.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					cancelable: true,
					pointerId: 41,
					pointerType: 'touch',
					isPrimary: true,
					clientX: x,
					clientY: y
				})
			);
		}, point);
		if (step === 2) await during?.();
	}
	await page.waitForTimeout(24);
	await page.evaluate(({ x, y }) => {
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				cancelable: true,
				pointerId: 41,
				pointerType: 'touch',
				isPrimary: true,
				clientX: x,
				clientY: y
			})
		);
	}, to);
}

async function browserTouchDrag(
	page: import('@playwright/test').Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	during?: () => Promise<void>,
	hold = 0
) {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ ...from, id: 1 }]
	});
	if (hold) await page.waitForTimeout(hold);
	for (let step = 1; step <= 4; step += 1) {
		const point = {
			x: from.x + ((to.x - from.x) * step) / 4,
			y: from.y + ((to.y - from.y) * step) / 4
		};
		await page.waitForTimeout(24);
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ ...point, id: 1 }]
		});
		if (step === 2) await during?.();
	}
	await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await client.detach();
}

function sessionButton(page: import('@playwright/test').Page, title: string) {
	return page.locator('.session-select').filter({ hasText: title });
}

function primarySessionSurface(page: import('@playwright/test').Page) {
	return page.locator('.session-pane-primary .session-view');
}

async function openComposerOptions(page: import('@playwright/test').Page) {
	const surface = primarySessionSurface(page);
	const button = surface.getByRole('button', { name: 'More session options' });
	if ((await button.isVisible()) && (await button.getAttribute('aria-expanded')) !== 'true')
		await button.click();
	return surface;
}

function recordRequestFailure(errors: string[], request: import('@playwright/test').Request) {
	if (
		request.method() === 'HEAD' &&
		/\/_app\/immutable\/assets\/data\.[^/]+\.json$/.test(request.url())
	)
		return;
	errors.push(`${request.method()} ${request.url()}`);
}

async function openMobileProjects(page: import('@playwright/test').Page) {
	if (page.viewportSize()!.width > 700) return;
	await page.waitForFunction(() => matchMedia('(max-width: 700px)').matches);
	await page.waitForTimeout(100);
	if ((await page.locator('#project-drawer').getAttribute('aria-hidden')) === 'false') return;
	if ((await page.locator('#session-drawer').getAttribute('aria-hidden')) === 'true') {
		await page.getByRole('button', { name: 'Back to Sessions' }).click();
		await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');
	}
	await page.getByRole('button', { name: 'Back to Projects' }).click();
	await expect(page.locator('#project-drawer')).toHaveAttribute('aria-hidden', 'false');
}

async function openMobileSessions(page: import('@playwright/test').Page) {
	if (page.viewportSize()!.width > 700) return;
	await page.waitForFunction(() => matchMedia('(max-width: 700px)').matches);
	await page.waitForTimeout(100);
	if ((await page.locator('#session-drawer').getAttribute('aria-hidden')) === 'false') return;
	if ((await page.locator('#project-drawer').getAttribute('aria-hidden')) === 'false') {
		await page.locator('#project-drawer .project-select[aria-current="page"]').click();
	} else {
		await page.getByRole('button', { name: 'Back to Sessions' }).click();
	}
	await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');
}

async function openAppSettings(page: import('@playwright/test').Page) {
	if (page.viewportSize()!.width <= 700) {
		await openMobileProjects(page);
		await page.getByRole('button', { name: 'App settings', exact: true }).click();
	} else {
		await page
			.getByRole('navigation', { name: 'Global navigation' })
			.getByRole('button', { name: 'App settings', exact: true })
			.click();
	}
}

async function openHermesSettings(page: import('@playwright/test').Page) {
	if (page.viewportSize()!.width <= 700) {
		await openAppSettings(page);
		await page.getByRole('button', { name: 'Open Hermes settings' }).click();
	} else {
		await page
			.getByRole('navigation', { name: 'Global navigation' })
			.getByRole('button', { name: 'Hermes settings', exact: true })
			.click();
	}
}

async function mockProjectWorkbenchRequests(page: import('@playwright/test').Page) {
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({
			json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
		})
	);
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
	await mockTerminalRequests(page);
}

async function mockTerminalRequests(page: import('@playwright/test').Page) {
	await page.route('**/api/projects/*/terminal**', async (route) => {
		if (route.request().method() === 'GET') {
			return route.fulfill({
				json: { output: '', cursor: 0, reset: false, status: 'running', exitCode: null }
			});
		}
		const body = (await route.request().postDataJSON()) as { action: string };
		return route.fulfill({
			json:
				body.action === 'create'
					? { terminalId: 'test-terminal', cursor: 0, status: 'running' }
					: { success: true }
		});
	});
}

async function mockDefaultSessionRequests(page: import('@playwright/test').Page) {
	await page.route(/\/api\/(?:projects\/[^/]+\/)?sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { sessions: [] } });
		return route.fulfill({ status: 503, json: { error: 'Test must define its Session fixture' } });
	});
}

async function addProject(page: import('@playwright/test').Page) {
	await page.goto('/');
	await openMobileProjects(page);
	const existing = page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' });
	if (await existing.count()) {
		if (
			(await existing.getAttribute('aria-current')) !== 'page' ||
			(page.viewportSize()!.width <= 700 && (await page.locator('#project-drawer').isVisible()))
		)
			await existing.click({ position: { x: 80, y: 22 } });
		return;
	}
	const response = await page.request.post('/api/projects', {
		data: {
			name: 'HUE',
			folders: [process.env.HUE_E2E_PROJECT_ROOT ?? process.cwd()],
			primaryPath: process.env.HUE_E2E_PROJECT_ROOT ?? process.cwd()
		}
	});
	if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
	await page.goto('/');
	await openMobileProjects(page);
	const created = page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' });
	if ((await created.getAttribute('aria-current')) !== 'page')
		await created.click({ position: { x: 80, y: 22 } });
}

async function removeProjects(page: import('@playwright/test').Page) {
	const response = await page.request.get('/api/projects');
	const body = (await response.json()) as { projects: Array<{ id: string }> };
	for (const project of body.projects) await page.request.delete(`/api/projects/${project.id}`);
}

async function chooseHermesSection(
	page: import('@playwright/test').Page,
	viewport: { width: number },
	value: string,
	label: string
) {
	if (viewport.width <= 700) await page.getByLabel('Settings section').selectOption(value);
	else
		await page
			.getByRole('region', { name: /Settings|Hermes management/ })
			.getByRole('button', { name: label, exact: true })
			.click();
}

test.beforeEach(async ({ page }) => {
	await mockTerminalRequests(page);
	await mockDefaultSessionRequests(page);
});

test('opens an unavailable Session without a row tooltip as read-only', async ({ page }) => {
	const recovery = 'Restore the Session folder at /work/missing to resume it.';
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'missing-session',
						cwd: '/work/missing',
						title: 'Missing Session',
						available: false,
						recovery
					}
				]
			}
		})
	);
	await page.route(/\/api\/projects\/[^/]+\/sessions\/missing-session$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Persisted recovery message' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				workMode: 'autonomous'
			}
		})
	);

	await page.setViewportSize(viewports[0]);
	await addProject(page);
	const workspaceUrl = page.url();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto(workspaceUrl);
		if (viewport.width <= 700) await openMobileSessions(page);
		const row = sessionButton(page, 'Missing Session');
		await expect(row).toBeVisible();
		await expect(row).toBeEnabled();
		await row.hover();
		await expect(page.getByRole('tooltip')).toHaveCount(0);
		await row.click();
		await expect(page.getByText('Persisted recovery message')).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: recovery })).toBeVisible();
		await expect(page.getByLabel('Message Hermes')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
});

test('global Session finder is keyboard-first, race-safe, and navigates directly', async ({
	page
}) => {
	await page.setViewportSize(viewports[0]);
	await page.goto('/');
	let projectsResponse = await page.request.get('/api/projects');
	let projectsBody = (await projectsResponse.json()) as {
		projects: Array<{ id: string; name: string; primaryPath: string }>;
	};
	if (!projectsBody.projects.length) {
		await addProject(page);
		projectsResponse = await page.request.get('/api/projects');
		projectsBody = (await projectsResponse.json()) as typeof projectsBody;
	}
	const project = projectsBody.projects[0];
	const session = {
		sessionId: 'finder-new',
		cwd: project.primaryPath,
		title: 'New result',
		projectId: project.id,
		projectName: project.name,
		status: 'waiting',
		archived: false,
		folder: 'Review',
		tags: ['p1']
	};
	await page.route('**/api/sessions/search**', async (route) => {
		const url = new URL(route.request().url());
		const query = url.searchParams.get('q');
		if (query === 'old') await new Promise((resolve) => setTimeout(resolve, 200));
		else await new Promise((resolve) => setTimeout(resolve, 10));
		await route.fulfill({
			json: {
				results:
					query === 'old'
						? [{ ...session, sessionId: 'finder-old', title: 'Old result' }]
						: query === 'new'
							? [session]
							: []
			}
		});
	});
	await page.route(
		new RegExp(`/api/projects/${project.id}/sessions\\?sessionId=finder-new`),
		(route) => route.fulfill({ json: { sessions: [session], hasMore: false } })
	);
	await page.route(`**/api/projects/${project.id}/sessions/finder-new`, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				cursor: 0,
				activeTurn: null,
				events: [],
				messages: [],
				runtime: { profile: 'default' }
			}
		})
	);

	const workspaceButton = page.getByRole('button', { name: 'Workspace' });
	await workspaceButton.focus();
	await page.keyboard.press('Control+k');
	const dialog = page.getByRole('dialog', { name: 'Find a Session' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('searchbox', { name: 'Search Sessions' })).toBeFocused();
	for (const label of ['Running', 'Waiting', 'Unknown', 'Failed', 'Archived']) {
		await expect(dialog.getByRole('button', { name: label })).toBeVisible();
	}
	await dialog.evaluate((element) => {
		element.dispatchEvent(new Event('cancel', { cancelable: true }));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
	});
	await expect(dialog).toBeVisible();

	const search = dialog.getByRole('searchbox', { name: 'Search Sessions' });
	await search.fill('old');
	await search.fill('new');
	await expect(dialog.getByText('New result')).toBeVisible();
	await page.waitForTimeout(250);
	await expect(dialog.getByText('Old result')).toHaveCount(0);

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(workspaceButton).toBeFocused();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.keyboard.press('Control+k');
		await expect(dialog).toBeVisible();
		expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(viewport.width);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(dialog.locator('button, input'));
		await page.keyboard.press('Escape');
	}
	await page.setViewportSize(viewports[0]);
	await page.keyboard.press('Control+k');
	await search.fill('new');
	await dialog.getByText('New result').click();
	await expect(page).toHaveURL(new RegExp(`project=${project.id}.*session=finder-new`));
});

test('the navigation rail toggles both panels and Projects still toggle Sessions', async ({
	page
}, testInfo) => {
	await page.setViewportSize(viewports[0]);
	await addProject(page);
	const project = page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' });
	const projects = page.getByRole('complementary', { name: 'Projects' });
	const sessions = page.getByRole('complementary', { name: 'Project contents' });
	await expect(page.getByRole('menuitem', { name: 'Add Project section' })).toBeHidden();
	await page.getByRole('button', { name: 'Project options' }).click();
	await page.getByRole('menuitem', { name: 'Add Project section' }).click();
	await expect(page.getByRole('dialog', { name: 'Add Project section' })).toBeVisible();
	await page
		.getByRole('dialog', { name: 'Add Project section' })
		.getByRole('button', { name: 'Cancel' })
		.click();
	const navigationToggle = page.getByRole('button', { name: 'Collapse navigation' });
	const toggleBox = (await navigationToggle.boundingBox())!;
	const globalRailBox = (await page
		.getByRole('navigation', { name: 'Global navigation' })
		.boundingBox())!;
	expect(toggleBox.width).toBeLessThanOrEqual(36);
	expect(toggleBox.height).toBeLessThanOrEqual(36);
	expect(
		globalRailBox.y + globalRailBox.height - (toggleBox.y + toggleBox.height)
	).toBeLessThanOrEqual(16);
	await navigationToggle.click();
	await expect(projects).toBeHidden();
	await expect(sessions).toBeHidden();
	expect(await page.evaluate(() => localStorage.getItem('hue:shell:projects:open'))).toBe('false');
	expect(await page.evaluate(() => localStorage.getItem('hue:shell:sessions:open'))).toBe('false');
	expect(
		await page
			.locator('.workspace')
			.evaluate(
				(element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
			)
	).toBe(2);
	await page.reload();
	await expect(projects).toBeHidden();
	await expect(sessions).toBeHidden();
	await page.getByRole('button', { name: 'Expand navigation' }).click();
	await expect(projects).toBeVisible();
	await expect(sessions).toBeVisible();

	for (const viewport of viewports.slice(0, 2)) {
		await page.setViewportSize(viewport);
		await expect(page.getByRole('button', { name: 'Project options' })).toBeVisible();
		await expect(project).toHaveAttribute('aria-expanded', 'true');
		await project.evaluate((button: HTMLButtonElement) => button.click());
		await expect(project).toHaveAttribute('aria-expanded', 'false');
		await expect(sessions).toBeHidden();
		expect(await page.evaluate(() => localStorage.getItem('hue:shell:sessions:open'))).toBe(
			'false'
		);
		if (viewport === viewports[0]) {
			await page.reload();
			await expect(sessions).toBeHidden();
		}
		await expect(page.getByRole('button', { name: 'Show Sessions panel' })).toHaveCount(0);
		expect(
			await page
				.locator('.workspace')
				.evaluate(
					(element) =>
						getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
				)
		).toBe(3);
		await testInfo.attach(`project-session-toggle-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await project.evaluate((button: HTMLButtonElement) => button.click());
		await expect(project).toHaveAttribute('aria-expanded', 'true');
		await expect(sessions).toBeVisible();
	}

	for (const viewport of viewports.slice(2)) {
		await page.setViewportSize(viewport);
		await openMobileProjects(page);
		const projectOptions = page.getByRole('button', { name: 'Project options' });
		await expect(projectOptions).toBeVisible();
		const optionsBox = (await projectOptions.boundingBox())!;
		expect(optionsBox.width).toBeGreaterThanOrEqual(44);
		expect(optionsBox.height).toBeGreaterThanOrEqual(44);
		await projectOptions.click();
		await expect(page.getByRole('menuitem', { name: 'Add Project section' })).toBeVisible();
		await projectOptions.click();
		await project.click({ position: { x: 80, y: 22 } });
		await expect(sessions).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
});

test('drags Sessions into independently interactive resizable chat panes', async ({ page }) => {
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'pane-alpha', cwd: '/work/hue', title: 'Pane alpha' },
					{ sessionId: 'pane-beta', cwd: '/work/hue', title: 'Pane beta' }
				]
			}
		})
	);
	await page.route(/\/sessions\/pane-(?:alpha|beta)$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);

	await page.setViewportSize(viewports[0]);
	await addProject(page);
	await sessionButton(page, 'Pane alpha').click();
	const panes = page.getByRole('region', { name: 'Session panes' });
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await sessionButton(page, 'Pane beta').dispatchEvent('dragstart', { dataTransfer });
	await panes.dispatchEvent('dragenter', { dataTransfer });
	await panes.dispatchEvent('dragover', { dataTransfer });
	await expect(page.locator('.session-drop-preview')).toBeVisible();
	await expect(page.locator('.session-drop-preview')).toHaveAttribute('data-destination', 'right');
	await panes.dispatchEvent('drop', { dataTransfer });

	await expect(panes).toHaveAttribute('data-pane-count', '2');
	await expect(panes.locator(':scope > article > .session-pane-header')).toHaveCount(2);
	await expect(page.getByRole('button', { name: 'Close Pane alpha pane' })).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Project browser' })).toBeHidden();
	const primary = panes.getByRole('article', { name: 'Pane alpha pane' });
	expect((await primary.getByRole('main').boundingBox())!.width).toBeGreaterThan(300);
	await expect(primary.getByLabel('Message Hermes')).toBeVisible();
	const secondary = panes.getByRole('article', { name: 'Pane beta pane' });
	await expect(secondary.getByLabel('Message Hermes')).toBeVisible();
	await expect(panes.locator('iframe')).toHaveCount(0);
	const duplicateTransfer = await page.evaluateHandle(() => new DataTransfer());
	await sessionButton(page, 'Pane alpha').dispatchEvent('dragstart', {
		dataTransfer: duplicateTransfer
	});
	await primary.dispatchEvent('dragover', { dataTransfer: duplicateTransfer });
	await expect(page.locator('.session-drop-preview')).toBeHidden();
	await primary.getByLabel('Message Hermes').fill('Primary draft');
	await secondary.getByLabel('Message Hermes').fill('Secondary draft');
	await expect(primary.getByLabel('Message Hermes')).toHaveValue('Primary draft');
	await expect(secondary.getByLabel('Message Hermes')).toHaveValue('Secondary draft');
	await expect
		.poll(() =>
			page.evaluate(
				() => Object.entries(localStorage).find(([key]) => key.endsWith(':pane-beta'))?.[1]
			)
		)
		.toBe('Secondary draft');
	await page.waitForTimeout(100);
	expect(
		(await page.getByRole('button', { name: 'Close Pane beta pane' }).boundingBox())!.height
	).toBeGreaterThanOrEqual(44);
	await page.reload();
	await expect(panes).toHaveAttribute('data-pane-count', '2');
	await expect(secondary.getByLabel('Message Hermes')).toBeVisible();
	for (const viewport of viewports.slice(1)) {
		await page.setViewportSize(viewport);
		await expect(panes).toHaveAttribute('data-pane-count', '2');
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		expect(
			(await page.getByRole('button', { name: 'Close Pane beta pane' }).boundingBox())!.height
		).toBeGreaterThanOrEqual(44);
	}
	await page.setViewportSize(viewports[0]);
});

test('reorders Session rows live while dragging', async ({ page }) => {
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'first-row', cwd: '/work/hue', title: 'First row' },
					{ sessionId: 'second-row', cwd: '/work/hue', title: 'Second row' }
				]
			}
		})
	);
	await page.setViewportSize(viewports[0]);
	await addProject(page);
	await page.evaluate(() => {
		for (const key of Object.keys(localStorage))
			if (key.startsWith('hue:session-order:')) localStorage.removeItem(key);
	});
	await page.reload();

	const first = sessionButton(page, 'First row');
	const second = sessionButton(page, 'Second row');
	const secondBox = (await second.boundingBox())!;
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await first.dispatchEvent('dragstart', { dataTransfer });
	await second.dispatchEvent('dragover', {
		dataTransfer,
		clientY: secondBox.y + secondBox.height - 1
	});
	await expect(page.locator('.session-select').nth(0)).toContainText('Second row');
	await expect(page.locator('.session-select').nth(1)).toContainText('First row');
	await first.dispatchEvent('dragend', { dataTransfer });
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Object.entries(localStorage).find(([key]) => key.startsWith('hue:session-order:'))?.[1]
			)
		)
		.toBe('["second-row","first-row"]');
	await page.getByRole('button', { name: 'Edit First row' }).click();
	await page
		.getByRole('dialog', { name: 'Session options' })
		.getByRole('button', { name: 'Move up' })
		.click();
	await expect(page.locator('.session-select').nth(0)).toContainText('First row');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Object.entries(localStorage).find(([key]) => key.startsWith('hue:session-order:'))?.[1]
			)
		)
		.toBe('["first-row","second-row"]');
});

test('reorders Project rows with touch dragging', async ({ page }) => {
	await removeProjects(page);
	const firstRoot = mkdtempSync(join(tmpdir(), 'hue-touch-project-first-'));
	const secondRoot = mkdtempSync(join(tmpdir(), 'hue-touch-project-second-'));
	try {
		const projectIds: string[] = [];
		for (const [name, root] of [
			['Touch first', firstRoot],
			['Touch second', secondRoot]
		]) {
			const response = await page.request.post('/api/projects', {
				data: { name, folders: [root], primaryPath: root }
			});
			expect(response.ok()).toBe(true);
			projectIds.push(((await response.json()) as { project: { id: string } }).project.id);
		}

		await page.setViewportSize(viewports[2]);
		await page.goto('/');
		await openMobileProjects(page);
		const first = page.locator('.project-select').filter({ hasText: 'Touch first' });
		const second = page.locator('.project-select').filter({ hasText: 'Touch second' });
		const firstBox = (await first.boundingBox())!;
		const secondBox = (await second.boundingBox())!;
		await browserTouchDrag(
			page,
			{ x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 },
			{ x: secondBox.x + secondBox.width / 2, y: secondBox.y + secondBox.height - 2 }
		);
		expect(await page.evaluate(() => localStorage.getItem('hue:project-order'))).toBeNull();
		await browserTouchDrag(
			page,
			{ x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 },
			{ x: firstBox.x + firstBox.width / 2, y: 820 },
			undefined,
			300
		);
		expect(await page.evaluate(() => localStorage.getItem('hue:project-order'))).toBeNull();

		await browserTouchDrag(
			page,
			{ x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 },
			{
				x: secondBox.x + secondBox.width / 2,
				y: secondBox.y + secondBox.height - 2
			},
			undefined,
			300
		);

		const reversedProjectIds = [...projectIds].reverse();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('hue:project-order')))
			.toBe(JSON.stringify(reversedProjectIds));
		await page.getByRole('button', { name: 'Edit Touch first' }).click();
		await page
			.getByRole('dialog', { name: 'Project options' })
			.getByRole('button', { name: 'Move up' })
			.click();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('hue:project-order')))
			.toBe(JSON.stringify(projectIds));
		await page.getByRole('button', { name: 'Close project options' }).click();

		const reordered = (await first.boundingBox())!;
		const tap = { x: reordered.x + reordered.width / 2, y: reordered.y + reordered.height / 2 };
		await browserTouchDrag(page, tap, tap);
		await expect(page.locator('#project-drawer')).toBeHidden();
		await expect(page.locator('#session-drawer')).toBeVisible();
	} finally {
		await removeProjects(page);
		rmSync(firstRoot, { recursive: true, force: true });
		rmSync(secondRoot, { recursive: true, force: true });
	}
});

test('discards stale persisted Session panes after loading the Project Sessions', async ({
	page
}) => {
	let staleRequests = 0;
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'pane-current', cwd: '/work/hue', title: 'Current pane' }]
			}
		})
	);
	await page.route(/\/sessions\/pane-stale-(?:primary|docked)$/, (route) => {
		staleRequests += 1;
		return route.fulfill({ status: 404, json: { error: 'Session not found' } });
	});

	await page.setViewportSize(viewports[0]);
	await addProject(page);
	const projectId = new URL(page.url()).searchParams.get('project')!;
	await page.evaluate((id) => {
		localStorage.setItem(
			`hue:session-panes:${id}`,
			JSON.stringify({
				sessions: [{ sessionId: 'pane-stale-docked', cwd: '/work/hue', title: 'Stale docked' }],
				primary: { sessionId: 'pane-stale-primary', cwd: '/work/hue', title: 'Stale primary' },
				column: 50,
				row: 50
			})
		);
	}, projectId);
	await page.reload();

	await expect(page.getByRole('region', { name: 'Session panes' })).toHaveAttribute(
		'data-pane-count',
		'1'
	);
	await expect
		.poll(() =>
			page.evaluate(
				(id) => JSON.parse(localStorage.getItem(`hue:session-panes:${id}`) ?? '{}'),
				projectId
			)
		)
		.toMatchObject({ sessions: [], primary: null });
	expect(staleRequests).toBe(0);
});

test('creates a Session without sending the button click event as work mode', async ({ page }) => {
	let createBody: string | null | undefined;
	await page.route('**/api/projects/*/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			createBody = route.request().postData();
			return route.fulfill({
				status: 201,
				json: { session: { sessionId: 'session-new', cwd: '/work/hue' }, commands: [] }
			});
		}
		return route.fulfill({ json: { sessions: [] } });
	});

	await addProject(page);
	await page.getByRole('button', { name: 'Add new session', exact: true }).click();

	expect(createBody).toBeNull();
});

test('Session header keeps search controls hidden until requested', async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(errors, request));
	await page.route('**/api/projects/*/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			return route.fulfill({
				status: 201,
				json: { session: { sessionId: 'session-new', cwd: '/work/hue' }, commands: [] }
			});
		}
		return route.fulfill({ json: { sessions: [] } });
	});
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await addProject(page);
		await openMobileSessions(page);

		const searchToggle = page.getByRole('button', { name: 'Search sessions' });
		const addButton = page.getByRole('button', { name: 'Add new session', exact: true });
		await expect(searchToggle).toBeVisible();
		await expect(addButton).toBeVisible();
		await expect(page.getByRole('searchbox', { name: 'Search Sessions' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Show archived sessions' })).toHaveCount(0);
		expect((await addButton.boundingBox())!.width).toBeLessThanOrEqual(44);

		await searchToggle.click();
		await expect(page.getByRole('searchbox', { name: 'Search Sessions' })).toBeFocused();
		await expect(page.getByRole('button', { name: 'Show archived sessions' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`session-header-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});

		await searchToggle.click();
		await expect(page.getByRole('searchbox', { name: 'Search Sessions' })).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});

test('conversation scrolls behind the translucent Session header', async ({ page }) => {
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'session-frosted', cwd: '/work/hue', title: 'Frosted header' }]
			}
		})
	);
	await page.route(/\/sessions\/session-frosted$/, (route) =>
		route.fulfill({
			json: {
				transcript: Array.from({ length: 12 }, (_, index) => ({
					role: 'assistant',
					text: `Conversation line ${index} `.repeat(20)
				})),
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	await sessionButton(page, 'Frosted header').click();

	const header = page.locator('.session-header');
	const transcript = page.locator('.transcript');
	const composer = page.locator('.composer');
	await expect(header).toHaveCSS('position', 'absolute');
	await expect(composer).toHaveCSS('position', 'absolute');
	await expect
		.poll(async () => (await transcript.boundingBox())?.y)
		.toBe((await header.boundingBox())?.y);
	expect(await header.evaluate((element) => getComputedStyle(element).backdropFilter)).not.toBe(
		'none'
	);
	await page.setViewportSize({ width: 1024, height: 768 });
	await expect(header).toHaveCSS('position', 'absolute');
	await expect
		.poll(async () => (await transcript.boundingBox())?.y)
		.toBe((await header.boundingBox())?.y);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(header).toHaveCSS('position', 'absolute');
	await transcript.evaluate((element) => element.scrollTo({ top: 160 }));
	expect(await transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	const headerBox = (await header.boundingBox())!;
	expect(
		await transcript.locator('article').evaluateAll(
			(articles, bounds) =>
				articles.some((article) => {
					const box = article.getBoundingClientRect();
					return box.top < bounds.bottom && box.bottom > bounds.top;
				}),
			{ top: headerBox.y, bottom: headerBox.y + headerBox.height }
		)
	).toBe(true);
	const composerBox = (await composer.boundingBox())!;
	expect(
		await transcript.locator('article').evaluateAll(
			(articles, bounds) =>
				articles.some((article) => {
					const box = article.getBoundingClientRect();
					return box.top < bounds.bottom && box.bottom > bounds.top;
				}),
			{ top: composerBox.y, bottom: composerBox.y + composerBox.height }
		)
	).toBe(true);

	await page.setViewportSize({ width: 320, height: 844 });
	await expect(header).toHaveCSS('position', 'absolute');
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('mobile Session list uses Telegram-scale rows and spacing', async ({ page }, testInfo) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (request.method() !== 'HEAD') browserErrors.push(`${request.method()} ${request.url()}`);
	});
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'telegram-scale',
						cwd: '/work/hue',
						title: 'Review and merge open PRs',
						updatedAt: '2026-08-27T20:53:31.000Z'
					}
				]
			}
		})
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await addProject(page);
	await openMobileSessions(page);

	const row = sessionButton(page, 'Review and merge open PRs');
	const icon = row.locator('xpath=preceding-sibling::button').locator('.session-icon');
	await page.getByRole('button', { name: 'Search sessions' }).click();
	const search = page.getByRole('searchbox', { name: 'Search Sessions' });

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 568 }
	]) {
		await page.setViewportSize(viewport);
		await expect(row).toBeVisible();
		await expect
			.poll(async () => Math.round((await page.locator('#session-drawer').boundingBox())!.x))
			.toBe(0);
		const rowBox = (await row.boundingBox())!;
		const searchBox = (await search.boundingBox())!;
		const dateBox = (await row.locator('small').boundingBox())!;
		expect(rowBox.height).toBeGreaterThanOrEqual(72);
		expect((await icon.boundingBox())!.width).toBeGreaterThanOrEqual(52);
		expect(searchBox.x).toBeGreaterThanOrEqual(16);
		expect(rowBox.x).toBeGreaterThanOrEqual(12);
		expect(
			await row.locator('strong').evaluate((element) => getComputedStyle(element).fontSize)
		).toBe('16px');
		expect(
			await row.locator('small').evaluate((element) => getComputedStyle(element).fontSize)
		).toBe('14px');
		expect(dateBox.height).toBeLessThan(20);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`telegram-session-list-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}

	for (const viewport of viewports.slice(0, 2)) {
		await page.setViewportSize(viewport);
		await expect(row).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`telegram-session-list-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}
	expect(browserErrors).toEqual([]);
});

test('Project tools stay docked across Sessions and collapse to their rail', async ({
	page
}, testInfo) => {
	const browserErrors: string[] = [];
	await page.setViewportSize(viewports[0]);
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'dock-alpha', cwd: '/work/hue', title: 'Dock alpha' },
					{ sessionId: 'dock-beta', cwd: '/work/hue', title: 'Dock beta' }
				]
			}
		})
	);
	await page.route(/\/sessions\/dock-(?:alpha|beta)$/, (route) =>
		route.fulfill({
			json: {
				transcript: route.request().url().endsWith('dock-alpha')
					? [
							{
								role: 'assistant',
								text: 'A long assistant response should use the available conversation width instead of collapsing into a narrow centered column.'
							}
						]
					: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				runtime: {
					profile: 'default',
					models: {
						currentModelId: 'openai:gpt-5.6',
						availableModels: [{ modelId: 'openai:gpt-5.6', name: 'GPT-5.6' }]
					},
					modes: {
						currentModeId: 'high',
						availableModes: [{ id: 'high', name: 'High' }]
					}
				}
			}
		})
	);
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({
			json: {
				isRepository: true,
				branch: 'main',
				changes: [
					{ path: 'one.ts', index: ' ', worktree: 'M', fileUrl: null },
					{ path: 'two.ts', index: 'M', worktree: ' ', fileUrl: null },
					{ path: 'three.ts', index: '?', worktree: '?', fileUrl: null }
				],
				worktrees: [],
				remotes: []
			}
		})
	);

	await page.setViewportSize(viewports[0]);
	await addProject(page);
	await sessionButton(page, 'Dock alpha').click();
	const dock = page.getByRole('navigation', { name: 'Project tools' });
	const workbench = page.getByRole('region', { name: 'HUE workbench' });
	await expect(dock).toBeVisible();
	await expect(workbench).toBeHidden();
	await expect(dock.getByRole('button', { name: 'Git, 3 changed files' })).toBeVisible();
	expect(await page.locator('.message-identity strong').textContent()).toBe(
		await page.getByRole('button', { name: 'Hermes model' }).locator('span').textContent()
	);
	const transcriptWidth = (await page.getByRole('region', { name: 'Conversation' }).boundingBox())!
		.width;
	const messageWidth = (await page.locator('.transcript article.assistant .message').boundingBox())!
		.width;
	expect(messageWidth).toBeGreaterThan(transcriptWidth * 0.7);
	for (const [paneName, separatorName] of [
		['Projects', 'Resize Projects'],
		['Project contents', 'Resize Sessions']
	] as const) {
		const pane = page.getByRole('complementary', { name: paneName });
		const widthBeforeResize = (await pane.boundingBox())!.width;
		await page.getByRole('separator', { name: separatorName }).focus();
		await page.keyboard.press('ArrowRight');
		await expect
			.poll(async () => (await pane.boundingBox())!.width)
			.toBeGreaterThan(widthBeforeResize);
	}
	await expect(dock.getByRole('button', { name: 'Browser', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await dock.getByRole('button', { name: 'Git, 3 changed files' }).click();
	await expect(workbench).toBeVisible();
	const splitter = page.getByRole('separator', { name: 'Resize project tools' });
	const widthBefore = (await workbench.boundingBox())!.width;
	await splitter.focus();
	await page.keyboard.press('ArrowLeft');
	await expect
		.poll(async () => (await workbench.boundingBox())!.width)
		.toBeGreaterThan(widthBefore);
	const gitPanel = workbench.getByRole('article', { name: 'Git status' });
	const gitHeight = (await gitPanel.boundingBox())!.height;
	const gitSplitter = page.getByRole('separator', { name: 'Resize Git and Worktrees' });
	const gitSplitterBox = (await gitSplitter.boundingBox())!;
	await page.mouse.move(gitSplitterBox.x + gitSplitterBox.width / 2, gitSplitterBox.y + 2);
	await page.mouse.down();
	await page.mouse.move(gitSplitterBox.x + gitSplitterBox.width / 2, gitSplitterBox.y + 26);
	await page.mouse.up();
	await expect.poll(async () => (await gitPanel.boundingBox())!.height).toBeGreaterThan(gitHeight);
	const draggedGitHeight = (await gitPanel.boundingBox())!.height;
	await gitSplitter.focus();
	await page.keyboard.press('ArrowDown');
	await expect
		.poll(async () => (await gitPanel.boundingBox())!.height)
		.toBeGreaterThan(draggedGitHeight);
	await dock.getByRole('button', { name: 'Files', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Project files' })).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Project browser' })).toBeHidden();
	for (const panel of await page.locator('.session-workspace > :visible').all()) {
		const box = (await panel.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(viewports[0].width);
	}
	await dock.getByRole('button', { name: 'Browser', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Project browser' })).toBeVisible();
	await expect(workbench).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Project files' })).toBeHidden();
	await dock.getByRole('button', { name: 'Terminal', exact: true }).click();
	await expect(workbench).toBeVisible();
	await expect(dock.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	const terminalPanel = page.getByRole('article', { name: 'Project terminal' });
	await expect(terminalPanel).toBeVisible();
	const terminalBox = (await page
		.getByRole('region', { name: 'Workspace terminal panel' })
		.boundingBox())!;
	const chatBox = (await page.getByRole('main').boundingBox())!;
	const browserBox = (await page
		.getByRole('complementary', { name: 'Project browser' })
		.boundingBox())!;
	expect(terminalBox.x).toBeLessThanOrEqual(chatBox.x + 1);
	expect(terminalBox.x + terminalBox.width).toBeGreaterThan(browserBox.x + browserBox.width - 2);
	expect(terminalBox.y).toBeGreaterThan(browserBox.y);
	expect((await page.locator('.composer').boundingBox())!.y).toBeLessThan(terminalBox.y);
	const terminalHeight = terminalBox.height;
	await page.getByRole('separator', { name: 'Resize Terminal' }).focus();
	await page.keyboard.press('ArrowUp');
	await expect
		.poll(
			async () =>
				(await page.getByRole('region', { name: 'Workspace terminal panel' }).boundingBox())!.height
		)
		.toBeGreaterThan(terminalHeight);
	await sessionButton(page, 'Dock beta').click();
	await expect(page).toHaveURL(/session=dock-beta/);
	await expect(dock.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await testInfo.attach('session-project-tools-1440x900', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
	await page.setViewportSize(viewports[1]);
	await page.locator('.projectless-row > .project-select').first().click();
	await page
		.locator('.project-rail nav .project-select')
		.filter({ hasText: 'HUE' })
		.evaluate((button: HTMLButtonElement) => button.click());
	await sessionButton(page, 'Dock beta').click();
	await expect(page.getByRole('navigation', { name: 'Project tools' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'HUE workbench' })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
	await testInfo.attach('session-project-tools-1024x768', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});

	for (const viewport of viewports.slice(2)) {
		await page.setViewportSize(viewport);
		await expect(page.getByRole('navigation', { name: 'Project tools' })).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`session-project-tools-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}
	expect(browserErrors).toEqual([]);
});

test('restores Git panel sizes and collapsed sections', async ({ page }) => {
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({
			json: {
				isRepository: true,
				branch: 'main',
				changes: [{ path: 'one.ts', index: ' ', worktree: 'M', fileUrl: null }],
				worktrees: [],
				remotes: []
			}
		})
	);
	await page.setViewportSize(viewports[0]);
	await addProject(page);
	const dock = page.getByRole('navigation', { name: 'Project tools' });
	await dock.getByRole('button', { name: 'Git, 1 changed files' }).click();
	const git = page.getByRole('article', { name: 'Git status' });
	const worktrees = page.getByRole('article', { name: 'Git worktrees' });
	await page.getByRole('separator', { name: 'Resize Git and Worktrees' }).focus();
	await page.keyboard.press('ArrowDown');
	await git.getByRole('button', { name: 'Collapse Git status' }).click();
	await worktrees.getByRole('button', { name: 'Collapse Git worktrees' }).click();
	const projectId = new URL(page.url()).searchParams.get('project')!;
	expect(
		await page.evaluate(
			(id) => localStorage.getItem(`hue:project-tools:${id}:panel-sizes`),
			projectId
		)
	).not.toBeNull();
	await page.reload();
	await expect(git.getByRole('button', { name: 'Expand Git status' })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expect(worktrees.getByRole('button', { name: 'Expand Git worktrees' })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
});

test('typing in an empty Project chat creates a Session without losing the draft', async ({
	page
}) => {
	let completeSessionCreation!: () => void;
	const sessionCreation = new Promise<void>((resolve) => (completeSessionCreation = resolve));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() !== 'POST') return route.fulfill({ json: { sessions: [] } });
		await sessionCreation;
		return route.fulfill({
			status: 201,
			json: {
				session: { sessionId: 'draft-session', cwd: '/work/hue', title: 'New Session' },
				commands: []
			}
		});
	});
	await page.setViewportSize(viewports[0]);
	await addProject(page);
	const composer = page.getByLabel('Message Hermes');
	await expect(composer).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Project tools' })).toBeVisible();
	await composer.fill('Plan the release');
	await expect(composer).toHaveValue('Plan the release');
	completeSessionCreation();
	await expect(page).toHaveURL(/session=draft-session/);
	await expect(composer).toHaveValue('Plan the release');
});

test('Project file workspace stays usable across required viewports', async ({
	page
}, testInfo) => {
	test.setTimeout(90_000);
	await page.setViewportSize(viewports[0]);
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => {
		if (!(request.method() === 'HEAD' && request.url().includes('/_app/immutable/')))
			browserErrors.push(`${request.method()} ${request.url()}`);
	});
	await page.route('**/api/projects/*/files**', async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === 'POST')
			return route.fulfill({ status: 409, json: { error: 'File changed outside HUE' } });
		if (url.searchParams.get('mode') === 'preview')
			return route.fulfill({
				json:
					url.searchParams.get('path') === '.env'
						? {
								path: '.env',
								name: '.env',
								type: 'file',
								kind: 'text',
								mime: 'text/plain',
								size: 11,
								mtime: new Date(0).toISOString(),
								version: { hash: 'env', mtimeNs: '1', size: 11 },
								content: 'HUE_TEST=1\n'
							}
						: url.searchParams.get('path') === 'README.md'
							? {
									path: 'README.md',
									name: 'README.md',
									type: 'file',
									kind: 'markdown',
									mime: 'text/markdown',
									size: 12,
									mtime: new Date(0).toISOString(),
									version: { hash: 'abc', mtimeNs: '1', size: 12 },
									content: '# HUE\nReady'
								}
							: {
									path: 'src/main.ts',
									name: 'main.ts',
									type: 'file',
									kind: 'code',
									mime: 'text/plain',
									size: 20,
									mtime: new Date(0).toISOString(),
									version: { hash: 'def', mtimeNs: '1', size: 20 },
									content: 'export const hue = true;'
								}
			});
		if (url.searchParams.get('mode') === 'artifacts')
			return route.fulfill({ json: { artifacts: [] } });
		if (url.searchParams.get('mode') === 'impact')
			return route.fulfill({ status: 503, json: { error: 'Delete impact unavailable' } });
		return route.fulfill({
			json: {
				entries: [
					{
						name: '.env',
						path: '.env',
						type: 'file',
						size: 11,
						mtime: new Date(0).toISOString()
					},
					{
						name: 'README.md',
						path: 'README.md',
						type: 'file',
						size: 12,
						mtime: new Date(0).toISOString()
					},
					{
						name: 'src',
						path: 'src',
						type: 'directory',
						size: 0,
						mtime: new Date(0).toISOString()
					},
					{
						name: 'main.ts',
						path: 'src/main.ts',
						type: 'file',
						size: 20,
						mtime: new Date(0).toISOString()
					}
				],
				truncated: false,
				limits: { maxEntries: 10000, maxDepth: 32 }
			}
		});
	});
	await page.route('**/api/projects/*/workflows', (route) =>
		route.fulfill({
			json: {
				workflows: [
					{ id: 'evidence', name: 'Collect evidence', prompt: 'Collect release evidence' }
				]
			}
		})
	);
	await addProject(page);
	await page.getByRole('button', { name: 'Files', exact: true }).click();
	await expect(
		page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: 'Browser', exact: true })
	).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByPlaceholder('Search files…')).toBeVisible();
	await page.evaluate(() => {
		const preferences = JSON.parse(localStorage.getItem('hue:preferences') ?? '{}');
		preferences.hiddenFilePatterns = '.env';
		localStorage.setItem('hue:preferences', JSON.stringify(preferences));
		window.dispatchEvent(new CustomEvent('hue:preferences', { detail: preferences }));
	});
	await expect(page.getByRole('treeitem', { name: '.env', exact: true })).toHaveCount(0);
	await page.evaluate(() => {
		const preferences = JSON.parse(localStorage.getItem('hue:preferences') ?? '{}');
		preferences.hiddenFilePatterns = '.DS_Store';
		localStorage.setItem('hue:preferences', JSON.stringify(preferences));
		window.dispatchEvent(new CustomEvent('hue:preferences', { detail: preferences }));
	});
	await expect(page.getByRole('treeitem', { name: '.env', exact: true })).toBeVisible();
	const filesDock = page.getByRole('complementary', { name: 'Project files' });
	const filesResizer = page.getByRole('separator', { name: 'Resize project files' });
	const initialFilesWidth = (await filesDock.boundingBox())!.width;
	await filesResizer.focus();
	await page.keyboard.press('ArrowRight');
	expect((await filesDock.boundingBox())!.width).toBeLessThan(initialFilesWidth);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Home');
	const fileSidebar = page.locator('.file-sidebar');
	const sidebarBox = (await fileSidebar.boundingBox())!;
	for (const name of [
		'Create file',
		'Create folder',
		'Refresh files',
		'Expand all folders',
		'Collapse all folders',
		'Upload files'
	]) {
		const actionBox = (await fileSidebar.getByLabel(name, { exact: true }).boundingBox())!;
		expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1);
	}
	await page.keyboard.press('End');
	await page.getByRole('treeitem', { name: '.env', exact: true }).click();
	await expect(page.getByLabel('File content')).toHaveValue('HUE_TEST=1\n');
	await page.getByRole('treeitem', { name: /README.md/ }).click();
	await expect(page.getByLabel('File workspace')).toContainText('README.md');
	await expect(page.getByRole('button', { name: 'Close Files workspace' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'README.md' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Preview Markdown' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const tree = page.getByRole('tree', { name: 'Project file tree' });
	await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
	await page.getByRole('treeitem', { name: /README.md/ }).focus();
	await page.keyboard.press('End');
	await expect(page.getByRole('treeitem', { name: /src/ })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('treeitem', { name: /src/ })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	expect(
		await page.evaluate(() =>
			JSON.parse(
				localStorage.getItem(
					`hue:project-files:${new URL(location.href).searchParams.get('project')}:expanded`
				) ?? '[]'
			)
		)
	).toContain('src');
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('treeitem', { name: /main.ts/ })).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(page.getByRole('treeitem', { name: /src/ })).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(page.getByRole('treeitem', { name: /src/ })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await page.getByRole('treeitem', { name: /README.md/ }).click();
	await page.getByRole('button', { name: 'Delete file' }).click();
	await expect(page.getByRole('alert')).toContainText('Delete impact unavailable');
	await page.getByRole('button', { name: 'Edit Markdown source' }).click();
	await expect(page.locator('.file-editor-highlight .syntax-heading')).toContainText('HUE');
	await page.getByLabel('File content').fill('# Unsaved');
	await page.setViewportSize(viewports[0]);
	expect(await page.evaluate(() => window.innerWidth)).toBe(viewports[0].width);
	expect(await page.evaluate(() => matchMedia('(max-width: 700px)').matches)).toBe(false);
	const browserButton = page
		.getByRole('navigation', { name: 'Project tools' })
		.getByRole('button', { name: 'Browser', exact: true });
	if ((await browserButton.getAttribute('aria-expanded')) !== 'true') await browserButton.click();
	await expect(page.getByRole('complementary', { name: 'Project browser' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Project files' })).toBeHidden();
	await page
		.getByRole('navigation', { name: 'Project tools' })
		.getByRole('button', { name: 'Files', exact: true })
		.click();
	await expect(page.getByLabel('File content')).toHaveValue('# Unsaved');
	for (const action of [
		page.getByRole('button', { name: 'Refresh files' }),
		page.getByRole('button', { name: 'Close Files workspace' }),
		page.getByRole('button', { name: 'Rename or move file' }),
		page.getByRole('button', { name: 'Delete file' }),
		page.getByRole('button', { name: 'Project', exact: true })
	]) {
		await action.click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
	}
	expect(
		await page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			return !window.dispatchEvent(event);
		})
	).toBe(true);
	await page.getByRole('button', { name: 'Close Files workspace' }).click();
	await page.getByRole('button', { name: 'Discard changes' }).click();
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'App settings' })
		.click();
	await expect(page.getByRole('dialog', { name: 'App settings dialog' })).toBeVisible();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await page
		.getByRole('navigation', { name: 'Project tools' })
		.getByRole('button', { name: 'Files', exact: true })
		.click();
	await expect(page.getByRole('region', { name: 'Project files' })).toBeVisible();
	await expect(
		page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: 'Files', exact: true })
	).toHaveAttribute('aria-expanded', 'true');
	await page.getByRole('button', { name: 'Close Files workspace' }).click();
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'Hermes settings' })
		.click();
	await page
		.getByRole('region', { name: 'Settings' })
		.getByRole('button', { name: 'Runtime', exact: true })
		.click();
	await expect(page.getByRole('region', { name: 'Hermes management' })).toBeVisible();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await page
		.getByRole('navigation', { name: 'Project tools' })
		.getByRole('button', { name: 'Files', exact: true })
		.click();
	await expect(page.getByRole('region', { name: 'Project files' })).toBeVisible();
	await page.getByLabel('File content').fill('# Unsaved again');
	await page.getByRole('treeitem', { name: /src/ }).click();
	await page.getByRole('treeitem', { name: /main.ts/ }).click();
	await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
	await page.getByRole('button', { name: 'Keep editing' }).click();
	await page.getByRole('button', { name: 'Save file' }).click();
	await expect(
		page.locator('p[role="alert"]').filter({ hasText: 'File changed outside HUE' })
	).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		if (viewport.width <= 700) {
			await page.waitForFunction(() => document.querySelector('.mobile-project-tools') !== null);
			const entry = page.getByRole('button', { name: 'Open Project tools' });
			if (await entry.isVisible()) await entry.click();
			const filesView = page
				.getByRole('navigation', { name: 'Project workbench views' })
				.getByRole('button', { name: 'Files', exact: true });
			if ((await filesView.getAttribute('aria-pressed')) !== 'true') await filesView.click();
			const backToFiles = page.getByRole('button', { name: 'Back to files' });
			if (await backToFiles.isVisible()) {
				await backToFiles.click();
				const guard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
				if (await guard.isVisible())
					await page.getByRole('button', { name: 'Discard changes' }).click();
			}
			await page.getByRole('treeitem', { name: /README.md/ }).click();
			await page.getByRole('button', { name: 'Edit Markdown source' }).click();
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await expect(page.getByRole('region', { name: 'Project files' })).toBeVisible();
		await page.getByLabel('File content').focus();
		await expect(page.getByLabel('File content')).toBeFocused();
		await testInfo.attach(`project-files-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(
				page.getByRole('region', { name: 'Project files' }).locator('button')
			);
			await expect(page.getByRole('button', { name: 'Back to files' })).toBeVisible();
		}
	}
	expect(browserErrors.filter((message) => !message.includes('409 (Conflict)'))).toEqual([
		'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
	]);
});

test('stale file preview cannot replace or save over newer selection with matching version', async ({
	page
}) => {
	const pending = new Map<string, import('@playwright/test').Route>();
	const saved: Array<{ path: string; content: string }> = [];
	const version = { hash: 'same', mtimeNs: '1', size: 4 };
	await page.route('**/api/projects/*/files**', async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === 'POST') {
			const body = (await route.request().postDataJSON()) as { path: string; content: string };
			saved.push(body);
			return route.fulfill({
				json: {
					path: body.path,
					name: body.path,
					type: 'file',
					kind: 'code',
					mime: 'text/plain',
					size: body.content.length,
					mtime: new Date(0).toISOString(),
					version,
					content: body.content
				}
			});
		}
		if (url.searchParams.get('mode') === 'preview') {
			pending.set(url.searchParams.get('path')!, route);
			return;
		}
		return route.fulfill({
			json: {
				entries: [
					{
						name: 'old.ts',
						path: 'old.ts',
						type: 'file',
						size: 4,
						mtime: new Date(0).toISOString()
					},
					{
						name: 'new.ts',
						path: 'new.ts',
						type: 'file',
						size: 4,
						mtime: new Date(0).toISOString()
					}
				],
				truncated: false
			}
		});
	});
	await addProject(page);
	await page.getByRole('button', { name: 'Files', exact: true }).click();
	await page.getByRole('treeitem', { name: /old\.ts/ }).click();
	await expect.poll(() => pending.has('old.ts')).toBe(true);
	await page.getByRole('treeitem', { name: /new\.ts/ }).click();
	await expect.poll(() => pending.has('new.ts')).toBe(true);
	await pending.get('new.ts')!.fulfill({
		json: {
			path: 'new.ts',
			name: 'new.ts',
			type: 'file',
			kind: 'code',
			mime: 'text/plain',
			size: 4,
			mtime: new Date(0).toISOString(),
			version,
			content: 'new!'
		}
	});
	await expect(page.getByRole('heading', { name: 'new.ts' })).toBeVisible();
	await pending
		.get('old.ts')!
		.fulfill({
			json: {
				path: 'old.ts',
				name: 'old.ts',
				type: 'file',
				kind: 'code',
				mime: 'text/plain',
				size: 4,
				mtime: new Date(0).toISOString(),
				version,
				content: 'old!'
			}
		})
		.catch(() => undefined);
	await expect(page.getByRole('heading', { name: 'new.ts' })).toBeVisible();
	await page.getByLabel('File content').fill('save newer');
	await page.getByRole('button', { name: 'Save file' }).click();
	await expect.poll(() => saved.length).toBe(1);
	expect(saved[0]).toMatchObject({ path: 'new.ts', content: 'save newer' });
});

test('production file endpoint validates and ranges real Project content', async ({ page }) => {
	await removeProjects(page);
	await addProject(page);
	const projects = (await (await page.request.get('/api/projects')).json()) as {
		projects: Array<{ id: string }>;
	};
	const projectId = projects.projects[0].id;
	const tree = await page.request.get(
		`/api/projects/${projectId}/files?mode=tree&maxEntries=20&maxDepth=1`
	);
	expect(tree.ok()).toBe(true);
	expect(
		((await tree.json()) as { entries: Array<{ path: string }> }).entries.some(
			({ path }) => path === 'README.md'
		)
	).toBe(true);
	const content = await page.request.get(
		`/api/projects/${projectId}/files?mode=content&path=README.md`,
		{ headers: { range: 'bytes=0-7' } }
	);
	expect(content.status()).toBe(206);
	expect(content.headers()['x-content-type-options']).toBe('nosniff');
	expect(content.headers()['content-range']).toMatch(/^bytes 0-7\//);
});

test('shows honest first-run actions without persisted Projects', async ({ page }) => {
	await removeProjects(page);
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Start your first HUE workspace' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add Project', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start a chat' })).toBeVisible();
	await expect(page.getByText('No PTY', { exact: true })).toHaveCount(0);
});

test('recovers missing primary folders with folder management, archive, or projectless continuation', async ({
	page
}) => {
	await removeProjects(page);
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
	for (const [index, viewport] of viewports.entries()) {
		const retiredRoot = mkdtempSync(join(tmpdir(), 'hue-retired-project-'));
		const replacementRoot = mkdtempSync(join(tmpdir(), 'hue-located-project-'));
		const created = await page.request.post('/api/projects', {
			data: {
				name: `Missing ${viewport.width}`,
				folders: [retiredRoot],
				primaryPath: retiredRoot
			}
		});
		const project = (await created.json()).project as { id: string };
		rmSync(retiredRoot, { recursive: true, force: true });

		try {
			await page.setViewportSize(viewport);
			await page.goto(`/?project=${project.id}`);
			const recovery = page.getByRole('region', { name: 'Project folder unavailable' });
			if (!(await recovery.isVisible())) {
				await openMobileProjects(page);
				await page
					.locator('.project-select')
					.filter({ hasText: `Missing ${viewport.width}` })
					.click({ position: { x: 80, y: 22 } });
			}
			await expect(recovery).toBeVisible();
			await expect(page.getByRole('region', { name: /workbench/ })).toHaveCount(0);
			for (const label of ['Manage folders', 'Archive', 'Open without Project'])
				await expect(recovery.getByRole('button', { name: label, exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			if (viewport.width <= 390) await expectMinimumTouchTargets(recovery.locator('button'));

			if (index === 0) {
				await recovery.getByRole('button', { name: 'Open without Project' }).click();
				await expect(page).toHaveURL(/project=none/);
			} else if (index === 1) {
				await recovery.getByRole('button', { name: 'Archive', exact: true }).click();
				await page
					.getByRole('dialog', { name: 'Archive Hermes Project?' })
					.getByRole('button', { name: 'Archive Project' })
					.click();
				await expect(page.getByText(`Missing ${viewport.width}`, { exact: true })).toHaveCount(0);
			} else {
				await page.route(/\/api\/directories/, (route) =>
					route.fulfill({
						json: {
							path: replacementRoot,
							name: `Located ${viewport.width}`,
							parent: null,
							entries: []
						}
					})
				);
				await recovery.getByRole('button', { name: 'Manage folders' }).click();
				await expect(page).toHaveURL(/pane=projects/);
				await expect(page.locator('#project-drawer')).toBeVisible();
				await page
					.getByRole('dialog', { name: 'Project options' })
					.getByRole('button', { name: 'Add folder' })
					.click();
				await page
					.getByRole('dialog', { name: `Add folder to Missing ${viewport.width}` })
					.getByRole('button', { name: 'Add this folder' })
					.click();
				const editor = page.getByRole('dialog', { name: 'Project options' });
				if (!(await editor.isVisible())) {
					await page.getByRole('button', { name: `Edit Missing ${viewport.width}` }).click();
				}
				await editor
					.locator('div.rounded-lg', { hasText: replacementRoot })
					.getByRole('button', { name: 'Make primary' })
					.click();
				await editor.getByRole('button', { name: 'Close project options' }).click();
				if (viewport.width > 700) {
					await expect(page.getByRole('region', { name: /workbench/ })).toBeVisible();
					const health = page.getByRole('region', { name: 'Runtime health' });
					for (const label of [
						'Project',
						'Git',
						'Terminal',
						'Preview',
						'Hermes ACP',
						'Hermes admin'
					])
						await expect(health.getByText(label, { exact: true })).toBeVisible();
				}
				await page.unroute(/\/api\/directories/);
			}
		} finally {
			await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
			rmSync(replacementRoot, { recursive: true, force: true });
		}
	}
});

test('keeps the current saved Preview address in a compact bottom status bar', async ({ page }) => {
	await page.route('http://preview.test/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<h1>Preview ready</h1>' })
	);
	await addProject(page);
	const health = page.getByRole('region', { name: 'Runtime health' });
	const preview = health.locator('[data-health-id="preview"]');

	await expect(preview).toContainText('No saved address');
	await page.getByLabel('Browser address').fill('http://preview.test');
	await page.getByRole('button', { name: 'Go', exact: true }).click();

	await expect(preview).toContainText('preview.test');
	await page.setViewportSize({ width: 320, height: 844 });
	await expect(health).toBeHidden();
});

test('keeps workspace scrolling inside its panes', async ({ page }) => {
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-overflow', cwd: '/work/hue', title: 'Overflow' }] }
		})
	);
	await page.route(/\/sessions\/session-overflow$/, (route) =>
		route.fulfill({
			json: {
				transcript: Array.from({ length: 20 }, (_, index) => ({
					role: index % 2 ? 'assistant' : 'user',
					text: `Long message ${index} `.repeat(30)
				})),
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await addProject(page);
		await sessionButton(page, 'Overflow').click();
		expect(
			await page.evaluate(() => ({
				clientHeight: document.documentElement.clientHeight,
				scrollHeight: document.documentElement.scrollHeight
			}))
		).toEqual({ clientHeight: viewport.height, scrollHeight: viewport.height });
		await page.mouse.wheel(0, 1000);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	}
});

test('opens project creation from the Projects heading and dismisses it with Escape', async ({
	page
}) => {
	const browserErrors: string[] = [];
	let submittedProject: { name: string; folders: string[]; primaryPath: string } | undefined;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (!(request.method() === 'HEAD' && request.url().includes('/_app/immutable/')))
			browserErrors.push(`${request.method()} ${request.url()}`);
	});
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
			json: {
				project: {
					id: 'picked-project',
					name: submittedProject?.name,
					icon: null,
					primaryPath: submittedProject?.primaryPath,
					folders: submittedProject?.folders.map((path) => ({
						path,
						label: null,
						isPrimary: path === submittedProject?.primaryPath,
						available: true
					})),
					rootAvailable: true
				}
			}
		});
	});
	await page.route(/\/api\/projects\/picked-project\/sessions$/, (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
	await page.route('/api/projects/picked-project/workflows', (route) =>
		route.fulfill({ json: { workflows: [] } })
	);
	await page.route('**/api/health?projectId=picked-project', (route) =>
		route.fulfill({ json: { checks: [] } })
	);
	await page.route('/api/projects/picked-project/repository', (route) =>
		route.fulfill({
			json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
		})
	);
	await page.route('/api/projects/picked-project/terminal**', async (route) => {
		if (route.request().method() === 'GET') {
			return route.fulfill({
				json: { output: '', cursor: 0, reset: false, status: 'running', exitCode: null }
			});
		}
		const body = (await route.request().postDataJSON()) as { action: string };
		return route.fulfill({
			json:
				body.action === 'create'
					? { terminalId: 'picked-terminal', cursor: 0, status: 'running' }
					: { success: true }
		});
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await openMobileProjects(page);
		const dialog = page.getByRole('dialog', { name: 'Create Hermes Project' });
		const addButton = page
			.locator('.section-heading')
			.getByRole('button', { name: 'Add Hermes Project' });
		await expect(dialog).toBeHidden();
		await addButton.click();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Documents' })).toBeFocused();
		await expect(dialog.getByText('/Users/example', { exact: true })).toBeVisible();
		const projectName = dialog.getByLabel('Project name');
		const directoryBrowser = dialog.getByRole('region', { name: 'Directories' });
		expect(
			await dialog.evaluate((element) => {
				const input = element.querySelector('input[required]');
				const browser = element.querySelector('[aria-label="Directories"]');
				return Boolean(
					input &&
					browser &&
					input.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING
				);
			})
		).toBe(true);
		expect(
			await directoryBrowser.evaluate((browser) => getComputedStyle(browser).maxHeight)
		).not.toBe('none');
		const dialogBox = await dialog.boundingBox();
		if (viewport.width > 700) {
			expect(Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport.width / 2)).toBeLessThan(2);
			expect(Math.abs(dialogBox!.y + dialogBox!.height / 2 - viewport.height / 2)).toBeLessThan(2);
		} else {
			expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
			expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
			expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
			expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
		}
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
			await dialog.getByRole('button', { name: 'Select current folder' }).click();
			await dialog.getByRole('button', { name: 'Documents' }).click();
			await dialog.getByRole('button', { name: 'Select current folder' }).click();
			await dialog.getByRole('radio', { name: '/Users/example/Documents' }).check();
			await dialog.getByLabel('Project name').fill('example');
			await dialog.getByRole('button', { name: 'Create Project' }).click();
			await expect(dialog).toBeHidden();
			expect(submittedProject).toEqual({
				name: 'example',
				folders: ['/Users/example', '/Users/example/Documents'],
				primaryPath: '/Users/example/Documents'
			});
		}
	}
	expect(browserErrors).toEqual([]);
});

test('edits authoritative Project metadata and folders, then archives it', async ({ page }) => {
	test.setTimeout(60_000);
	const rootPath = mkdtempSync(join(tmpdir(), 'hue-edit-project-'));
	const secondRoot = mkdtempSync(join(tmpdir(), 'hue-edit-project-docs-'));
	const response = await page.request.post('/api/projects', {
		data: { name: 'Editable project', folders: [rootPath, secondRoot], primaryPath: rootPath }
	});
	const project = (await response.json()).project as { id: string; primaryPath: string };
	let currentName = 'Editable project';
	try {
		const invalidIcon = await page.request.patch(`/api/projects/${project.id}`, {
			data: { action: 'update', name: currentName, icon: 'data:text/html;base64,PHNjcmlwdD4=' }
		});
		expect(invalidIcon.status()).toBe(400);
		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			await page.goto('/');
			await openMobileProjects(page);
			const editButton = page.getByRole('button', { name: `Edit ${currentName}` });
			await editButton.click();
			const dialog = page.getByRole('dialog', { name: 'Project options' });
			await expect(dialog).toBeVisible();
			if (viewport.width === 1440) {
				await expect(dialog.getByText(rootPath, { exact: true })).toBeVisible();
				await expect(dialog.getByText(secondRoot, { exact: true })).toBeVisible();
			}
			await dialog.getByRole('button', { name: 'Archive Project' }).click();
			const confirmation = page.getByRole('dialog', { name: 'Archive Hermes Project?' });
			await expect(confirmation).toBeVisible();
			await expect(confirmation).toContainText(`Archive ${currentName}?`);
			if (viewport.width <= 390) await expectMinimumTouchTargets(confirmation.locator('button'));
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			await confirmation.getByRole('button', { name: 'Cancel' }).click();
			await expect(confirmation).toBeHidden();
			if (!(await dialog.isVisible())) {
				await page.getByRole('button', { name: `Edit ${currentName}` }).click();
			}
			await expect(dialog).toBeVisible();
			if (viewport.width === 1440) {
				const secondFolder = dialog.locator('div.rounded-lg', { hasText: secondRoot });
				await secondFolder.getByPlaceholder('Optional label').fill('Docs');
				await secondFolder.getByRole('button', { name: 'Save label' }).click();
				await secondFolder.getByRole('button', { name: 'Make primary' }).click();
				const firstFolder = dialog.locator('div.rounded-lg', { hasText: rootPath });
				await firstFolder.getByRole('button', { name: 'Remove' }).click();
				await expect(dialog.getByText(rootPath, { exact: true })).toHaveCount(0);
				await dialog.getByRole('button', { name: 'Change project icon' }).click();
				const iconEditor = page.getByRole('dialog', { name: 'Project icon' });
				const picker = iconEditor.locator('emoji-picker');
				await expect(picker).toBeVisible();
				await picker.getByRole('combobox', { name: 'Search' }).fill('bug');
				await picker.getByRole('option', { name: /bug/i }).first().click();
				await expect(dialog.locator('.project-icon-preview')).toHaveText('🐛');
			}
			if (viewport.width === 390) {
				await dialog.getByRole('button', { name: 'Change project icon' }).click();
				await page
					.getByRole('dialog', { name: 'Project icon' })
					.getByLabel('Project icon image')
					.setInputFiles({
						name: 'project.png',
						mimeType: 'image/png',
						buffer: Buffer.from(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
							'base64'
						)
					});
				await expect(
					page.locator('.project-select', { hasText: currentName }).locator('img')
				).toBeVisible();
			}
			if (viewport.width === 320) {
				await dialog.getByRole('button', { name: 'Change project icon' }).click();
				await expect(
					page
						.getByRole('dialog', { name: 'Project icon' })
						.locator('emoji-picker')
						.getByRole('combobox', { name: 'Search' })
				).toBeVisible();
				await page.getByRole('button', { name: 'Close Project icon editor' }).click();
			}
			const renamed = `Renamed ${viewport.width}`;
			if (!(await dialog.isVisible())) {
				await page.getByRole('button', { name: `Edit ${currentName}` }).click();
			}
			await dialog.getByLabel('Name').fill(renamed);
			await dialog.getByLabel('Name').press('Tab');
			currentName = renamed;
			const renamedProject = page.locator('.project-select', { hasText: currentName });
			await expect(renamedProject).toBeAttached();
			if (viewport.width === 1440) {
				await renamedProject.click();
				await expect(page.locator('.selected-project-title .title-icon')).toHaveText('🐛');
			}
			if (viewport.width < 390) {
				await expect(renamedProject.locator('.project-icon-image')).toBeVisible();
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
		}
		const editDialog = page.getByRole('dialog', { name: 'Project options' });
		if (!(await editDialog.isVisible())) {
			await page.getByRole('button', { name: `Edit ${currentName}` }).click();
		}
		await editDialog.getByRole('button', { name: 'Archive Project' }).click();
		const confirmation = page.getByRole('dialog', { name: 'Archive Hermes Project?' });
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole('button', { name: 'Archive Project' }).click();
		await expect(page.locator('.project-select', { hasText: currentName })).toHaveCount(0);
	} finally {
		if (project) await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		rmSync(rootPath, { recursive: true, force: true });
		rmSync(secondRoot, { recursive: true, force: true });
	}
});

test('keeps unresolved-delivery archive conflict visible without false removal', async ({
	page
}) => {
	const rootPath = mkdtempSync(join(tmpdir(), 'hue-project-unknown-delivery-'));
	const created = await page.request.post('/api/projects', {
		data: { name: 'Unknown delivery project', folders: [rootPath], primaryPath: rootPath }
	});
	const project = (await created.json()).project as { id: string };
	await page.route(`**/api/projects/${project.id}`, async (route) => {
		if (route.request().method() === 'DELETE') {
			return route.fulfill({
				status: 409,
				json: { error: 'Project has unresolved message delivery' }
			});
		}
		return route.continue();
	});

	try {
		await page.goto(`/?project=${project.id}`);
		await page.getByRole('button', { name: 'Edit Unknown delivery project' }).click();
		await page
			.getByRole('dialog', { name: 'Project options' })
			.getByRole('button', { name: 'Archive Project' })
			.click();
		const confirmation = page.getByRole('dialog', { name: 'Archive Hermes Project?' });
		await confirmation.getByRole('button', { name: 'Archive Project' }).click();

		await expect(confirmation).toBeVisible();
		await expect(confirmation.getByRole('alert')).toContainText(
			'Project has unresolved message delivery'
		);
		await expect(page.getByRole('button', { name: 'Edit Unknown delivery project' })).toBeVisible();
	} finally {
		await page.unroute(`**/api/projects/${project.id}`);
		await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		rmSync(rootPath, { recursive: true, force: true });
	}
});

test('shows automatic session emojis and allows a custom override', async ({ page }) => {
	let savedIcon = '';
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'session-icon',
						cwd: '/work/hue',
						title: 'Friendly greeting',
						icon: savedIcon || '👋'
					}
				]
			}
		})
	);
	await page.route('**/sessions/session-icon', async (route) => {
		if (route.request().method() === 'PATCH') {
			savedIcon = ((await route.request().postDataJSON()) as { icon: string }).icon;
			return route.fulfill({ json: { icon: savedIcon } });
		}
		return route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});

	await addProject(page);
	await expect(page.locator('.session-row-icon .session-icon')).toHaveText('👋');
	const rowIcon = page.getByRole('button', { name: 'Change Friendly greeting icon' });
	const rowIconBox = (await rowIcon.boundingBox())!;
	await rowIcon.click();
	const rowEditor = page.getByRole('dialog', { name: 'Session icon' });
	await expect(rowEditor).toBeVisible();
	expect(await rowEditor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
		true
	);
	expect((await rowEditor.boundingBox())!.y).toBeGreaterThanOrEqual(
		rowIconBox.y + rowIconBox.height
	);
	await rowEditor.getByRole('button', { name: 'Close Session icon editor' }).click();
	await sessionButton(page, 'Friendly greeting').click();
	await page.getByRole('button', { name: 'Change icon for Friendly greeting' }).click();
	const menu = page.getByRole('dialog', { name: 'Session icon' });
	const picker = menu.locator('emoji-picker');
	await picker.getByRole('combobox', { name: 'Search' }).fill('bug');
	await picker.getByRole('option', { name: /bug/i }).first().click();
	await expect.poll(() => savedIcon).toBe('🐛');
	await expect(page.locator('.session-row-icon .session-icon')).toHaveText('🐛');
	await expect(page.locator('.session-icon-trigger .title-icon')).toHaveText('🐛');

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		let iconTrigger = page.getByRole('button', { name: 'Change icon for Friendly greeting' });
		if (viewport.width <= 700) {
			await openMobileSessions(page);
			iconTrigger = page.getByRole('button', { name: 'Change Friendly greeting icon' });
		}
		await iconTrigger.click();
		const editor = page.getByRole('dialog', { name: 'Session icon' });
		await expect(editor).toBeVisible();
		expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true
		);
		const box = (await editor.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
		await editor.getByRole('button', { name: 'Close Session icon editor' }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
});

test('personalizes one Session with template and uploaded chat backgrounds', async ({
	page
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'session-background', cwd: '/work/hue', title: 'Personal chat', icon: '🎨' },
					{ sessionId: 'empty-background', cwd: '/work/hue', title: 'Empty canvas', icon: '🖼️' }
				]
			}
		})
	);
	await page.route('**/sessions/empty-background', (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route('**/sessions/session-background', (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Make this space yours.' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);

	await addProject(page);
	await sessionButton(page, 'Personal chat').click();
	await expect
		.poll(() => page.locator('.transcript-content').evaluate((element) => element.clientWidth))
		.toBeLessThanOrEqual(768);
	await expect
		.poll(() => page.locator('.composer').evaluate((element) => element.clientWidth))
		.toBeLessThanOrEqual(768);
	await openAppSettings(page);
	let appSettings = page.getByRole('dialog', { name: 'App settings dialog' });
	const limitChatWidth = appSettings.getByLabel('Limit chat width');
	await expect(limitChatWidth).toBeChecked();
	await limitChatWidth.uncheck();
	await expect(page.locator('html')).toHaveAttribute('data-limit-chat-width', 'false');
	await limitChatWidth.check();
	await expect(page.locator('html')).toHaveAttribute('data-limit-chat-width', 'true');
	await appSettings.getByLabel('Chat font size').fill('18');
	await expect
		.poll(() =>
			page
				.locator('.message')
				.first()
				.evaluate((element) => getComputedStyle(element).fontSize)
		)
		.toBe('18px');
	expect(
		await page.evaluate(
			() => JSON.parse(localStorage.getItem('hue:preferences') ?? '{}').chatFontSize
		)
	).toBe(18);
	await appSettings.getByLabel('Hidden file patterns').fill('.DS_Store\n*.tmp');
	await expect
		.poll(() =>
			page.evaluate(
				() => JSON.parse(localStorage.getItem('hue:preferences') ?? '{}').hiddenFilePatterns
			)
		)
		.toBe('.DS_Store\n*.tmp');
	let generalBackground = appSettings.getByRole('group', { name: 'Default chat background' });
	const sunsetChoice = generalBackground.getByRole('button', { name: 'Sunset chat background' });
	await expect(sunsetChoice.locator('[data-mode="light"]')).toBeVisible();
	await expect(sunsetChoice.locator('[data-mode="dark"]')).toBeVisible();
	const sunsetPreviews = await sunsetChoice
		.locator('[data-mode]')
		.evaluateAll((previews) =>
			previews.map((preview) => getComputedStyle(preview).backgroundImage)
		);
	expect(sunsetPreviews).toHaveLength(2);
	expect(new Set(sunsetPreviews).size).toBe(2);
	await generalBackground.locator('input[type="file"]').setInputFiles({
		name: 'background.png',
		mimeType: 'image/png',
		buffer: readFileSync('static/favicon.png')
	});
	await expect(page.locator('.session-view')).toHaveAttribute('style', /data:image\/webp;base64/);
	await generalBackground.getByRole('button', { name: 'Ocean chat background' }).click();
	await appSettings.getByLabel('Theme').selectOption('light');
	const lightBackground = await page
		.locator('.session-view')
		.evaluate((element) => getComputedStyle(element).backgroundImage);
	await appSettings.getByLabel('Theme').selectOption('dark');
	await expect
		.poll(() =>
			page.locator('.session-view').evaluate((element) => getComputedStyle(element).backgroundImage)
		)
		.not.toBe(lightBackground);
	await appSettings.getByLabel('Theme').selectOption('light');
	await expect
		.poll(() =>
			page.locator('.session-view').evaluate((element) => getComputedStyle(element).backgroundImage)
		)
		.toBe(lightBackground);
	await appSettings.getByRole('button', { name: 'Close settings' }).click();
	await expect(page.locator('.session-view')).toHaveAttribute('style', /radial-gradient/);
	await expect
		.poll(() =>
			page.locator('.composer').evaluate((element) => getComputedStyle(element).backdropFilter)
		)
		.toContain('blur(20px)');
	await sessionButton(page, 'Empty canvas').click();
	await expect(page.locator('.session-view')).toHaveClass(/personal-background/);
	await expect(page.locator('.session-view')).toHaveAttribute('style', /radial-gradient/);
	await sessionButton(page, 'Personal chat').click();

	const optionsButton = page.getByRole('button', { name: 'Session settings for Personal chat' });
	await optionsButton.click();
	const options = page.getByRole('dialog', { name: 'Session options' });
	await options.getByRole('button', { name: 'Sunset chat background' }).click();
	await expect(page.locator('.session-view')).toHaveClass(/personal-background/);
	await expect(page.locator('.session-view')).toHaveAttribute('style', /radial-gradient/);
	await options.getByRole('button', { name: 'Close session options' }).click();

	await openAppSettings(page);
	appSettings = page.getByRole('dialog', { name: 'App settings dialog' });
	await expect(appSettings.getByLabel('Hidden file patterns')).toHaveValue('.DS_Store\n*.tmp');
	generalBackground = appSettings.getByRole('group', { name: 'Default chat background' });
	await generalBackground.getByRole('button', { name: 'Meadow chat background' }).click();
	await appSettings.getByRole('button', { name: 'Close settings' }).click();
	await optionsButton.click();
	await expect(options.getByRole('button', { name: 'Sunset chat background' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await options.getByRole('button', { name: 'General' }).click();
	await expect(options.getByRole('button', { name: 'General' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await options.locator('input[type="file"]').setInputFiles({
		name: 'background.png',
		mimeType: 'image/png',
		buffer: readFileSync('static/favicon.png')
	});
	await expect(page.locator('.session-view')).toHaveAttribute('style', /data:image\/webp;base64/);

	await options.getByRole('button', { name: 'None' }).click();
	await expect(page.locator('.session-view')).not.toHaveClass(/personal-background/);
	await options.getByRole('button', { name: 'Close session options' }).click();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await openAppSettings(page);
		appSettings = page.getByRole('dialog', { name: 'App settings dialog' });
		generalBackground = appSettings.getByRole('group', { name: 'Default chat background' });
		await expect(generalBackground).toBeVisible();
		const settingsBox = (await appSettings.boundingBox())!;
		expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(viewport.width);
		expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(viewport.height);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(generalBackground.locator('button, label'));
		await testInfo.attach(`general-chat-background-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await appSettings.getByRole('button', { name: 'Close settings' }).click();
		if (viewport.width <= 700) {
			await openMobileSessions(page);
			await sessionButton(page, 'Personal chat').click();
		}
		await optionsButton.click();
		await expect(options).toBeVisible();
		const box = (await options.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(options.locator('fieldset button, fieldset label'));
		await testInfo.attach(`chat-background-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await options.getByRole('button', { name: 'Close session options' }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('opens distinct Hermes runtime, skills, schedules, commands, profiles, and MCP panels', async ({
	page
}) => {
	let savedSkill = '';
	await page.route('/api/hermes/skills/browser-use', async (route) => {
		if (route.request().method() === 'PUT') {
			savedSkill = ((await route.request().postDataJSON()) as { content: string }).content;
			return route.fulfill({ json: { name: 'browser-use', content: savedSkill } });
		}
		return route.fulfill({
			json: {
				name: 'browser-use',
				content: '---\nname: browser-use\n---\n\n# Browser Use\n',
				provenance: 'custom',
				editable: true
			}
		});
	});
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) => {
		const view = new URL(route.request().url()).searchParams.get('view');
		const json =
			view === 'skills'
				? { skills: [{ name: 'browser-use', category: '', provenance: 'agent', enabled: true }] }
				: view === 'schedules'
					? {
							jobs: [
								{
									id: 'job-1',
									profile: 'work',
									name: 'Monthly check',
									schedule: '0 9 1 * *',
									status: 'active'
								}
							]
						}
					: view === 'profiles'
						? {
								profiles: [{ name: 'work', model: 'gpt-5.6-sol', gateway: 'running', active: true }]
							}
						: {
								profile: 'work',
								protocolVersion: 1,
								agent: { name: 'hermes-agent', version: '0.2.0' },
								capabilities: { loadSession: true }
							};
		return route.fulfill({ json });
	});
	await page.route('/api/hermes/mcp', (route) =>
		route.fulfill({
			json: {
				servers: [
					{ name: 'filesystem', transport: 'stdio', command: 'mcp-filesystem', enabled: true }
				]
			}
		})
	);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page).toHaveURL(/\?project=/);
		const globalRail = page.getByRole('navigation', { name: 'Global navigation' });
		const projectsMenu = page.getByRole('button', { name: 'Projects', exact: true });
		if (viewport.width > 700) {
			await expect(globalRail).toBeVisible();
			const railBox = (await globalRail.boundingBox())!;
			const projectsBox = (await page.locator('#project-drawer').boundingBox())!;
			expect(railBox.width).toBeLessThanOrEqual(64);
			expect(projectsBox.x).toBe(railBox.x + railBox.width);
			await globalRail.getByRole('button', { name: 'Hermes settings', exact: true }).click();
			await page
				.getByRole('region', { name: 'Settings' })
				.locator('.settings-grid')
				.getByRole('button', { name: 'Runtime' })
				.click();
		} else {
			await expect(globalRail).toBeHidden();
			await openHermesSettings(page);
			await page
				.getByRole('region', { name: 'Settings' })
				.locator('.settings-grid')
				.getByRole('button', { name: 'Runtime' })
				.click();
		}
		const panel = page.getByRole('region', { name: 'Hermes management' });
		await expect(panel).toBeVisible();
		await expect(panel.getByText('hermes-agent 0.2.0')).toBeVisible();
		await chooseHermesSection(page, viewport, 'skills', 'Skills');
		await expect(panel.getByRole('heading', { name: 'Installed skills' })).toBeVisible();
		await panel.getByRole('button', { name: 'browser-use' }).click();
		await expect(panel.getByLabel('Skill content')).toHaveValue(/# Browser Use/);
		await expect(panel.locator('.skill-editor-code .syntax-heading')).toContainText('Browser Use');
		await panel
			.getByLabel('Skill content')
			.fill('---\nname: browser-use\n---\n\n# Updated Browser Use\n');
		await expect(panel.locator('.skill-editor-code .syntax-heading')).toContainText(
			'Updated Browser Use'
		);
		await panel.getByRole('button', { name: 'Save skill' }).click();
		expect(savedSkill).toContain('# Updated Browser Use');
		await panel.getByRole('button', { name: 'Back to skills' }).click();
		await chooseHermesSection(page, viewport, 'schedules', 'Schedules');
		await expect(panel.getByRole('heading', { name: 'Scheduled jobs' })).toBeVisible();
		await expect(panel.getByText('Monthly check')).toBeVisible();
		await chooseHermesSection(page, viewport, 'profiles', 'Profiles');
		await expect(panel.getByRole('heading', { name: 'Profiles' })).toBeVisible();
		await expect(panel.getByText('gpt-5.6-sol')).toBeVisible();
		await chooseHermesSection(page, viewport, 'mcp', 'MCP');
		await expect(panel.getByRole('heading', { name: 'MCP servers' })).toBeVisible();
		await expect(panel.getByText('filesystem', { exact: true })).toBeVisible();
		await expect(panel.getByText('mcp-filesystem')).toBeVisible();
		await chooseHermesSection(page, viewport, 'commands', 'Commands');
		await expect(panel.getByRole('heading', { name: 'Session commands' })).toBeVisible();
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(panel.locator('button'));
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await panel.getByRole('button', { name: 'Close settings' }).click();
		await expect(panel).toBeHidden();
	}
});

test('guards unsaved skill edits across workspace and Project navigation', async ({ page }) => {
	const targetRoot = mkdtempSync(join(tmpdir(), 'hue-dirty-skill-target-'));
	const created = await page.request.post('/api/projects', {
		data: { name: 'Dirty skill target', folders: [targetRoot], primaryPath: targetRoot }
	});
	const target = (await created.json()).project as { id: string };
	await page.route('/api/hermes/skills/browser-use', (route) =>
		route.fulfill({
			json: {
				name: 'browser-use',
				content: '---\nname: browser-use\n---\n\n# Browser Use\n',
				provenance: 'custom',
				editable: true
			}
		})
	);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				skills: [{ name: 'browser-use', category: '', provenance: 'agent', enabled: true }]
			}
		})
	);

	try {
		await addProject(page);
		const globalNavigation = page.getByRole('navigation', { name: 'Global navigation' });
		await globalNavigation.getByRole('button', { name: 'Hermes settings', exact: true }).click();
		await page
			.getByRole('region', { name: 'Settings' })
			.locator('.settings-grid')
			.getByRole('button', { name: 'Skills' })
			.click();
		const panel = page.getByRole('region', { name: 'Hermes management' });
		await panel.getByRole('button', { name: 'browser-use' }).click();
		const editor = panel.getByLabel('Skill content');
		const edited = '---\nname: browser-use\n---\n\n# Unsaved Browser Use\n';
		await editor.fill(edited);

		await panel.getByRole('button', { name: 'Close settings' }).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(editor).toHaveValue(edited);

		await panel.getByRole('button', { name: 'Close settings' }).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(editor).toHaveValue(edited);

		expect(
			await page.evaluate(() => {
				const event = new Event('beforeunload', { cancelable: true });
				return !window.dispatchEvent(event);
			})
		).toBe(true);

		await panel.getByRole('button', { name: 'Close settings' }).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Discard changes' }).click();
		await expect(panel).toBeHidden();
	} finally {
		await page.request.delete(`/api/projects/${target.id}`).catch(() => undefined);
		rmSync(targetRoot, { recursive: true, force: true });
	}
});

test('opens every Hermes administration section from the Settings hub', async ({ page }) => {
	test.setTimeout(60_000);
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (!(request.method() === 'HEAD' && request.url().includes('/_app/immutable/')))
			browserErrors.push(`${request.method()} ${request.url()}`);
	});
	await mockProjectWorkbenchRequests(page);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) => {
		const view = new URL(route.request().url()).searchParams.get('view');
		return route.fulfill({
			json:
				view === 'skills'
					? { skills: [{ name: 'browser-use', category: '', source: 'local', status: 'enabled' }] }
					: { profile: 'work', protocolVersion: 1 }
		});
	});
	await page.goto('/');
	await expect(page).toHaveURL(/\?project=/);
	await openHermesSettings(page);
	let panel = page.getByRole('region', { name: 'Settings' });
	await expect(panel.getByRole('heading', { name: 'Settings' })).toBeVisible();
	for (const section of ['Runtime', 'Skills', 'Schedules', 'Commands', 'Profiles', 'MCP']) {
		await expect(
			panel.locator('.settings-grid').getByRole('button', { name: new RegExp(section) })
		).toBeVisible();
	}
	await panel
		.locator('.settings-grid')
		.getByRole('button', { name: /Skills/ })
		.click();
	await expect(page.getByRole('heading', { name: 'Installed skills' })).toBeVisible();
	await page.getByRole('button', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page).toHaveURL(/\?project=/);
		if (viewport.width > 700) {
			await openHermesSettings(page);
		} else {
			await openHermesSettings(page);
		}
		panel = page.getByRole('region', { name: 'Settings' });
		await expect(panel.locator('.settings-grid')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(panel.locator('button'));
	}
	expect(browserErrors).toEqual([]);
});

test('summarises, filters, and groups installed skills', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (!(request.method() === 'HEAD' && request.url().includes('/_app/immutable/')))
			browserErrors.push(`${request.method()} ${request.url()}`);
	});
	await mockProjectWorkbenchRequests(page);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				skills: [
					{ name: 'browser-use', category: '', source: 'local', status: 'enabled' },
					{ name: 'hermes-themes', category: '', source: 'local', status: 'enabled' },
					{ name: 'apple-notes', category: 'apple', source: 'builtin', status: 'enabled' },
					{ name: 'dogfood', category: 'testing', source: 'official', status: 'disabled' }
				]
			}
		})
	);

	await page.goto('/');
	await expect(page).toHaveURL(/\?project=/);
	await openHermesSettings(page);
	await page
		.getByRole('region', { name: 'Settings' })
		.locator('.settings-grid')
		.getByRole('button', { name: /Skills/ })
		.click();
	const panel = page.getByRole('region', { name: 'Hermes management' });
	const statistics = panel.getByRole('region', { name: 'Skill statistics' });
	await expect(statistics.getByLabel('4 installed skills')).toBeVisible();
	await expect(statistics.getByLabel('3 enabled skills')).toBeVisible();
	await expect(statistics.getByLabel('3 skill categories')).toBeVisible();
	await expect(statistics.getByLabel('3 skill sources')).toBeVisible();

	await panel.getByLabel('Filter skills by source').selectOption('local');
	await expect(panel.getByText('2 of 4 skills')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'apple-notes' })).toBeHidden();
	await panel.getByLabel('Filter installed skills').fill('themes');
	await expect(panel.getByText('1 of 4 skills')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'hermes-themes' })).toBeVisible();

	await panel.getByLabel('Filter installed skills').fill('');
	await panel.getByLabel('Filter skills by source').selectOption('all');
	await panel.getByLabel('Group skills').selectOption('category');
	await expect(panel.getByRole('heading', { name: 'Uncategorised' })).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Apple' })).toBeVisible();
	await panel.getByLabel('Filter skills by status').selectOption('disabled');
	await expect(panel.getByText('1 of 4 skills')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'dogfood' })).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page).toHaveURL(/\?project=/);
		await openHermesSettings(page);
		await page
			.getByRole('region', { name: 'Settings' })
			.locator('.settings-grid')
			.getByRole('button', { name: /Skills/ })
			.click();
		await expect(page.getByRole('region', { name: 'Skill statistics' })).toBeVisible();
		await expect(page.getByLabel('Filter skills by category')).toBeVisible();
		await expect(page.getByLabel('Group skills')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(
				page.locator('.skill-controls input, .skill-controls select, .inventory-row')
			);
		}
	}
	expect(browserErrors).toEqual([]);
});

test('summarises, filters, and groups scheduled jobs', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await mockProjectWorkbenchRequests(page);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				jobs: [
					{
						id: 'monthly',
						name: 'Monthly check',
						cron: '0 9 1 * *',
						enabled: true,
						nextRunAt: 'Sep 1, 09:00',
						prompt: 'Monthly review',
						sessionId: 'monthly-session'
					},
					{
						id: 'digest',
						name: 'Daily digest',
						cron: '0 8 * * *',
						enabled: true,
						prompt: 'Daily digest',
						sessionId: 'digest-session'
					},
					{
						id: 'cleanup',
						name: 'Weekly cleanup',
						cron: '0 3 * * 0',
						enabled: false,
						prompt: 'Weekly cleanup',
						sessionId: 'cleanup-session'
					},
					{
						id: 'legacy',
						name: 'Legacy sync',
						cron: '0 0 * * *',
						enabled: false,
						prompt: 'Legacy sync',
						sessionId: 'legacy-session'
					}
				]
			}
		})
	);

	await page.goto('/');
	await expect(page).toHaveURL(/\?project=/);
	await openHermesSettings(page);
	await page
		.getByRole('region', { name: 'Settings' })
		.locator('.settings-grid')
		.getByRole('button', { name: /Schedules/ })
		.click();
	const panel = page.getByRole('region', { name: 'Hermes management' });
	const statistics = panel.getByRole('region', { name: 'Schedule statistics' });
	await expect(statistics.getByLabel('4 scheduled jobs')).toBeVisible();
	await expect(statistics.getByLabel('2 active jobs')).toBeVisible();
	await expect(statistics.getByLabel('2 inactive jobs')).toBeVisible();
	await expect(panel.getByText('Next Sep 1, 09:00')).toBeVisible();

	await panel.getByLabel('Filter schedules by status').selectOption('paused');
	await expect(panel.getByText('2 of 4 jobs')).toBeVisible();
	await expect(panel.getByText('Weekly cleanup')).toBeVisible();
	await panel.getByLabel('Filter schedules by status').selectOption('all');
	await panel.getByLabel('Filter scheduled jobs').fill('monthly');
	await expect(panel.getByText('1 of 4 jobs')).toBeVisible();
	await expect(panel.getByText('Monthly check')).toBeVisible();

	await panel.getByLabel('Filter scheduled jobs').fill('');
	await panel.getByLabel('Group schedules').selectOption('status');
	await expect(panel.getByRole('heading', { name: 'Active' })).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Paused' })).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page).toHaveURL(/\?project=/);
		await openHermesSettings(page);
		await page
			.getByRole('region', { name: 'Settings' })
			.locator('.settings-grid')
			.getByRole('button', { name: /Schedules/ })
			.click();
		await expect(page.getByRole('region', { name: 'Schedule statistics' })).toBeVisible();
		await expect(page.getByLabel('Filter scheduled jobs')).toBeVisible();
		await expect(page.getByLabel('Group schedules')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(
				page.locator('.schedule-controls input, .schedule-controls select')
			);
		}
	}
	expect(browserErrors).toEqual([]);
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
	await openHermesSettings(page);
	await page
		.getByRole('region', { name: 'Settings' })
		.locator('.settings-grid')
		.getByRole('button', { name: /Runtime/ })
		.click();
	await page.getByRole('button', { name: 'Close settings' }).click();
	await openHermesSettings(page);
	await page
		.getByRole('region', { name: 'Settings' })
		.locator('.settings-grid')
		.getByRole('button', { name: /Runtime/ })
		.click();
	const panel = page.getByRole('region', { name: 'Hermes management' });
	await expect(panel.getByText('current', { exact: true })).toBeVisible();
	releaseFirst();
	await expect(panel.getByText('current', { exact: true })).toBeVisible();
	await expect(panel.getByText('stale', { exact: true })).toBeHidden();
});

test('capability-gates Hermes v0.20.5 administration and keeps controls responsive', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await mockProjectWorkbenchRequests(page);
	await page.route('/api/hermes/mcp', (route) =>
		route.fulfill({
			json: {
				capabilities: { configure: true, toggle: true, health: true, auth: true, tools: true },
				servers: [
					{
						name: 'remote',
						transport: 'http',
						url: 'https://example.test/mcp',
						auth: 'oauth',
						enabled: true
					}
				]
			}
		})
	);
	await page.route('/api/hermes/admin', (route) =>
		route.fulfill({
			json: {
				health: { ok: true },
				tools: [{ name: 'search' }],
				target: { name: 'remote', enabled: true }
			}
		})
	);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) => {
		const view = new URL(route.request().url()).searchParams.get('view');
		const bodies: Record<string, unknown> = {
			memory: {
				capabilities: {
					memoryEditor: false,
					memoryHistory: false,
					skillDelete: false,
					skillLinkedFiles: false
				},
				status: { active: 'builtin', builtin_files: { memory: 10, user: 20 } },
				unsupported: ['Hermes v0.20.5 has no authenticated memory document read/write/history API.']
			},
			schedules: {
				capabilities: { schedules: true },
				jobs: [
					{
						id: 'daily',
						name: 'Daily',
						cron: '0 9 * * *',
						enabled: true,
						nextRunAt: '2026-08-29T09:00:00.000Z',
						prompt: 'Review HUE',
						sessionId: 'scheduled-session'
					}
				]
			},
			models: {
				capabilities: { validatedAssignment: true, browserCredentials: false },
				options: {
					providers: [{ slug: 'openai', name: 'OpenAI', models: ['gpt-5'], authenticated: true }]
				}
			},
			profiles: {
				capabilities: { create: true, clone: true, switch: true, delete: true },
				profiles: [
					{
						name: 'default',
						is_default: true,
						provider: 'openai',
						model: 'gpt-5',
						skill_count: 12,
						gateway_running: true
					}
				],
				active: { active: 'default', current: 'default' }
			},
			skills: { capabilities: { create: true, edit: true, toggle: true }, skills: [] }
		};
		return route.fulfill({
			json: bodies[view ?? ''] ?? {
				profile: 'default',
				protocolVersion: 1,
				agent: { name: 'hermes-agent', version: '0.20.5' },
				administration: {
					health: { ok: true, version: '0.20.5', auth_required: false },
					status: {
						gateway_running: true,
						nous_session_valid: true,
						config_version: 44,
						latest_config_version: 44
					},
					logs: { lines: [] },
					update: { message: 'Latest version.' }
				}
			}
		});
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await page.getByRole('button', { name: 'App settings', exact: true }).last().click();
		let panel = page.getByRole('region', { name: 'Settings' });
		await expect(panel.getByRole('region', { name: 'HUE preferences' })).toBeVisible();
		await panel.getByLabel('Theme').selectOption('oled');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
		await page.getByRole('button', { name: 'App settings', exact: true }).last().click();
		panel = page.getByRole('region', { name: 'Settings' });
		await page.getByRole('button', { name: 'Open Hermes settings' }).click();
		await chooseHermesSection(page, viewport, 'memory', 'Memory');
		panel = page.getByRole('region', { name: 'Hermes management' });
		await expect(panel.getByText('Unavailable upstream')).toBeVisible();
		await chooseHermesSection(page, viewport, 'schedules', 'Schedules');
		await expect(panel.getByRole('button', { name: 'Run now' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Run history' })).toBeVisible();
		await expect(panel.getByRole('link', { name: 'Review Session' })).toHaveAttribute(
			'href',
			'/?project=none&collection=cron&session=scheduled-session'
		);
		await chooseHermesSection(page, viewport, 'mcp', 'MCP');
		await expect(panel.getByLabel('MCP bearer token')).toHaveAttribute('type', 'password');
		await panel.getByRole('button', { name: 'Test health & tools' }).click();
		await expect(panel.getByText('search', { exact: false })).toBeVisible();
		await chooseHermesSection(page, viewport, 'models', 'Models');
		await expect(
			panel.getByText('Stored provider credentials never enter HUE browser payloads.')
		).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(panel.locator('button'));
	}
	expect(browserErrors).toEqual([]);
});

test('sends one complete envelope and renders streamed completion', async ({ page }) => {
	const captured: { envelope?: { messageId: string; text: string } } = {};
	let finishCompletion!: () => void;
	const completion = new Promise<void>((resolve) => (finishCompletion = resolve));
	const browserErrors: string[] = [];
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
	});
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/projects/*/sessions', async (route) => {
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
					},
					{
						sequence: 5,
						type: 'agent.image',
						payload: {
							messageId: captured.envelope?.messageId,
							image: {
								name: 'Hermes image',
								mimeType: 'image/png',
								data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WvAAAAAElFTkSuQmCC'
							}
						}
					}
				]
			}
		});
	});
	await page.route(/\/sessions\/session-send\/events\?after=5$/, async (route) => {
		await completion;
		await route.fulfill({
			json: {
				events: [
					{
						sequence: 6,
						type: 'message.completed',
						payload: { messageId: captured.envelope?.messageId }
					}
				]
			}
		});
	});

	await page.emulateMedia({ reducedMotion: 'reduce' });
	await addProject(page);
	await sessionButton(page, 'Send').click();
	const surface = primarySessionSurface(page);
	const text = 'Complete message 🧭 with final words intact.';
	await surface.getByLabel('Message Hermes').fill(text);
	await surface.getByRole('button', { name: 'Send', exact: true }).click();

	await expect(surface.getByRole('button', { name: 'Thinking' })).toBeVisible();
	await expect(surface.getByTitle('Message running')).toBeVisible();
	const deliveryStatus = surface.locator('.composer-delivery');
	await expect(deliveryStatus).toHaveClass(/rounded-full/);
	const capsuleStyle = await deliveryStatus.evaluate((element) => ({
		background: getComputedStyle(element).backgroundColor,
		radius: Number.parseFloat(getComputedStyle(element).borderRadius),
		height: element.getBoundingClientRect().height
	}));
	expect(capsuleStyle.background).not.toBe('rgba(0, 0, 0, 0)');
	expect(capsuleStyle.radius).toBeGreaterThanOrEqual(capsuleStyle.height / 2);
	await expect(deliveryStatus.locator('[data-status-icon="running"]')).toBeVisible();
	await expect(deliveryStatus.locator('svg')).toHaveClass(/animate-spin/);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(surface.getByRole('button', { name: 'Thinking' })).toBeVisible();
		const [deliveryBox, composerBox] = await Promise.all([
			surface.locator('.composer-delivery').boundingBox(),
			surface.locator('.composer').boundingBox()
		]);
		expect(deliveryBox).not.toBeNull();
		expect(deliveryBox!.y + deliveryBox!.height).toBeLessThanOrEqual(composerBox!.y);
		expect(deliveryBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
		expect(deliveryBox!.x).toBeLessThan(composerBox!.x + composerBox!.width / 2);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await expect
			.poll(() =>
				page
					.locator('.transcript')
					.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
			)
			.toBeLessThanOrEqual(2);
	}
	await surface.getByRole('button', { name: 'Thinking' }).click();
	await expect(page.getByText('Checking the request before answering.')).toBeVisible();
	const assistant = page.locator('.transcript article.assistant');
	await expect(assistant.locator('.message strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	await expect(assistant.getByRole('img', { name: 'Hermes image' })).toBeVisible();
	finishCompletion();
	await expect(deliveryStatus).toHaveText('completed');
	await expect(deliveryStatus.locator('[data-status-icon="completed"]')).toBeVisible();
	await expect(deliveryStatus.locator('svg')).not.toHaveClass(/animate-spin/);
	await expect(assistant.locator('.message strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	expect(
		await page
			.locator('.transcript')
			.evaluate((element) => getComputedStyle(element, '::after').content)
	).toBe('none');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(assistant.locator('.message strong')).toBeVisible();
		if (viewport.width === 320) {
			await expectMinimumTouchTargets(page.locator('.composer textarea, .composer button'));
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(captured.envelope?.text).toBe(text);
	await expect(surface.getByLabel('Message Hermes')).toHaveValue('');
	expect(browserErrors).toEqual([]);
});

test('runs a voice call with mute, streaming speech, interruption, and end controls', async ({
	page
}) => {
	const browserErrors: string[] = [];
	let messageId = '';
	let cancelled = false;
	let speechInterrupted = false;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => {
		if (!speechInterrupted || !request.url().endsWith('/api/voice/speak')) {
			browserErrors.push(`${request.method()} ${request.url()}`);
		}
	});
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: async () => {
					const context = new AudioContext();
					return context.createMediaStreamDestination().stream;
				}
			}
		});
	});
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-voice', cwd: '/work/hue', title: 'Voice' }] }
		})
	);
	await page.route(/\/sessions\/session-voice$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route(/\/sessions\/session-voice\/messages$/, async (route) => {
		messageId = ((await route.request().postDataJSON()) as { messageId: string }).messageId;
		await route.fulfill({ status: 202, json: { messageId, status: 'queued' } });
	});
	await page.route(/\/sessions\/session-voice\/events\?after=0$/, (route) =>
		route.fulfill({
			json: {
				events: [
					{ sequence: 1, type: 'message.running', payload: { messageId } },
					{
						sequence: 2,
						type: 'agent.chunk',
						payload: { messageId, text: 'Voice answer.' }
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-voice\/events\?after=2$/, (route) =>
		route.fulfill({
			json: {
				events: cancelled
					? [{ sequence: 3, type: 'message.failed', payload: { messageId, error: 'cancelled' } }]
					: []
			}
		})
	);
	await page.route(/\/sessions\/session-voice\/cancel$/, async (route) => {
		cancelled = true;
		await route.fulfill({ json: { cancelled: true } });
	});
	await page.route('/api/voice/speak', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.fulfill({
			headers: { 'content-type': 'audio/L16', 'x-audio-sample-rate': '24000' },
			body: Buffer.from([0, 0, 0, 0])
		});
	});

	await addProject(page);
	await sessionButton(page, 'Voice').click();
	const surface = await openComposerOptions(page);
	await surface.getByRole('button', { name: 'Start voice call' }).click();
	const call = surface.getByRole('region', { name: 'Voice call controls' });
	await expect(call.locator('.voice-call-state')).toContainText('listening');
	await expect(call.getByRole('button', { name: 'Mute microphone' })).toBeFocused();
	await call.getByRole('button', { name: 'Mute microphone' }).click();
	await expect(call.locator('.voice-call-state')).toContainText('Muted');
	await call.getByRole('button', { name: 'Unmute microphone' }).click();
	await expect(call.locator('.voice-call-state')).toContainText('listening');

	await surface.getByLabel('Message Hermes').fill('Answer this aloud');
	await surface.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(call.locator('.voice-call-state')).toContainText('speaking');
	speechInterrupted = true;
	await call.getByRole('button', { name: 'Interrupt Hermes' }).click();
	await expect(call.locator('.voice-call-state')).toContainText('listening');

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await expect(call).toBeVisible();
		if (viewport.width <= 390) await expectMinimumTouchTargets(call.locator('button'));
	}
	await call.getByRole('button', { name: 'End voice call' }).click();
	await expect(call).toBeHidden();
	await expect(surface.getByRole('button', { name: 'More session options' })).toBeFocused();
	expect(browserErrors).toEqual([]);
});

test('records one voice message and submits its transcript directly', async ({ page }) => {
	let submitted = '';
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.addInitScript(() => {
		class FakeMediaRecorder {
			state = 'inactive';
			mimeType = 'audio/webm';
			ondataavailable: ((event: { data: Blob }) => void) | null = null;
			onstop: (() => void) | null = null;
			constructor(_stream: unknown) {}
			start() {
				this.state = 'recording';
				setTimeout(() => {
					this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
					this.stop();
				}, 2_000);
			}
			stop() {
				if (this.state !== 'recording') return;
				this.state = 'inactive';
				this.onstop?.();
			}
		}
		class FakeAudioContext {
			currentTime = 0;
			createMediaStreamSource() {
				return { connect() {} };
			}
			createAnalyser() {
				return {
					fftSize: 512,
					getByteTimeDomainData(samples: Uint8Array) {
						samples.fill(128);
					}
				};
			}
			close() {
				return Promise.resolve();
			}
		}
		Object.defineProperty(window, 'MediaRecorder', {
			configurable: true,
			value: FakeMediaRecorder
		});
		Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: async () => ({
					getAudioTracks: () => [{ enabled: true, stop() {} }],
					getTracks: () => [{ enabled: true, stop() {} }]
				})
			}
		});
	});
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-voice-note', cwd: '/work/hue', title: 'Note' }] }
		})
	);
	await page.route(/\/sessions\/session-voice-note$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route('/api/voice/transcribe', (route) =>
		route.fulfill({ json: { text: 'Recorded request' } })
	);
	await page.route(/\/sessions\/session-voice-note\/messages$/, async (route) => {
		submitted = ((await route.request().postDataJSON()) as { text: string }).text;
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/session-voice-note\/events.*/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await sessionButton(page, 'Note').click();
	await openComposerOptions(page);
	await page.getByRole('button', { name: 'Record voice message' }).click();
	await expect(page.getByRole('region', { name: 'Voice message controls' })).toContainText(
		'recording'
	);
	const controls = page.getByRole('region', { name: 'Voice message controls' });
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(controls).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(controls.locator('button'));
	}
	await expect.poll(() => submitted).toBe('Recorded request');
	await expect(controls).toBeHidden();
	expect(browserErrors).toEqual([]);
});

test('follows new chat content until the reader scrolls up', async ({ page }) => {
	const browserErrors: string[] = [];
	let failOtherRefresh = false;
	page.on('console', (message) => {
		if (message.type() === 'error' && !message.text().includes('500 (Internal Server Error)')) {
			browserErrors.push(message.text());
		}
	});
	page.on('pageerror', (error) => browserErrors.push(error.message));
	const transcript = Array.from({ length: 2 }, (_, index) => [
		{ role: 'user', text: `Earlier question ${index}` },
		{ role: 'assistant', text: `Earlier answer ${index} `.repeat(70) }
	]).flat();
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'session-sticky', cwd: '/work/hue', title: 'Sticky' },
					{ sessionId: 'session-other', cwd: '/work/hue', title: 'Other' }
				]
			}
		})
	);
	await page.route(/\/sessions\/(?:session-sticky|session-other)$/, (route) => {
		if (failOtherRefresh && route.request().url().endsWith('/session-other')) {
			return route.fulfill({ status: 500, json: { error: 'Refresh unavailable' } });
		}
		return route.fulfill({
			json: { transcript, messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});
	await page.route(/\/sessions\/session-sticky\/messages$/, (route) =>
		route.fulfill({ status: 202, json: { status: 'queued' } })
	);
	await page.route(/\/sessions\/session-sticky\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await addProject(page);
		await sessionButton(page, 'Sticky').click();
		const scroller = page.locator('.transcript');
		await expect
			.poll(
				async () =>
					scroller.evaluate(
						(element) => element.scrollHeight - element.scrollTop - element.clientHeight
					),
				{
					message: `${viewport.width}x${viewport.height}`
				}
			)
			.toBeLessThan(2);
		await page.getByLabel('Message Hermes').fill('Keep this question visible');
		await page.getByRole('button', { name: 'Send', exact: true }).click();
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);

		await scroller.evaluate((element) => {
			const growth = document.createElement('div');
			growth.dataset.testGrowth = 'following';
			growth.style.height = '300px';
			element.firstElementChild?.append(growth);
		});
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		const composerHeight = await page
			.locator('.composer')
			.evaluate((element) => element.clientHeight);

		await scroller.hover();
		await page.mouse.wheel(0, -300);
		await expect(page.getByRole('button', { name: 'Scroll to latest message' })).toHaveClass(
			/visible/
		);
		expect(await page.locator('.composer').evaluate((element) => element.clientHeight)).toBe(
			composerHeight
		);
		const releasedTop = await scroller.evaluate((element) => element.scrollTop);
		await scroller.evaluate((element) => {
			const growth = document.createElement('div');
			growth.dataset.testGrowth = 'released';
			growth.style.height = '300px';
			element.firstElementChild?.append(growth);
		});
		await page.waitForTimeout(50);
		expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(releasedTop, 0);
		const scrollButton = page.getByRole('button', { name: 'Scroll to latest message' });
		await scrollButton.evaluate((element) => (element as HTMLButtonElement).click());
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		await scroller.hover();
		await page.mouse.wheel(0, -300);
		if (viewport.width <= 700) await openMobileSessions(page);
		await sessionButton(page, 'Other').click();
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		if (viewport.width <= 700) await openMobileSessions(page);
		await sessionButton(page, 'Sticky').click();
		await scroller.hover();
		await page.mouse.wheel(0, -300);
		failOtherRefresh = true;
		if (viewport.width <= 700) await openMobileSessions(page);
		await sessionButton(page, 'Other').click();
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		failOtherRefresh = false;
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('copies and edits messages while selected-message fork stays honestly unavailable', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const sessions = [{ sessionId: 'message-actions', cwd: '/work/hue', title: 'Message actions' }];
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({ json: { sessions } })
	);
	await page.route(/\/sessions\/message-actions$/, async (route) => {
		if (route.request().method() === 'POST') {
			return route.fulfill({
				status: 201,
				json: {
					session: { sessionId: 'forked-actions', cwd: '/work/hue', title: 'Forked session' },
					commands: [],
					runtime: { profile: 'default' }
				}
			});
		}
		return route.fulfill({
			json: {
				transcript: [
					{ role: 'user', text: 'Please inspect this message' },
					{ role: 'assistant', text: 'Inspected.' }
				],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		});
	});
	await page.route(/\/sessions\/forked-actions$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);

	await addProject(page);
	await sessionButton(page, 'Message actions').click();
	const userMessage = page.locator('.transcript article.user');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(userMessage.locator('button'));
			expect(
				await userMessage.locator('.message-actions').evaluate((element) => ({
					background: getComputedStyle(element).backgroundColor,
					backdrop: getComputedStyle(element).backdropFilter
				}))
			).toEqual({ background: 'rgba(0, 0, 0, 0)', backdrop: 'none' });
			expect((await userMessage.locator('.message-actions svg').first().boundingBox())!.width).toBe(
				13
			);
		}
	}
	await userMessage.getByRole('button', { name: 'Copy message' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		'Please inspect this message'
	);
	await userMessage.getByRole('button', { name: 'Edit and resend message' }).click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Please inspect this message');
	const assistantMessage = page.locator('.transcript article.assistant');
	await assistantMessage.locator('.message').evaluate((element) => {
		const range = document.createRange();
		range.selectNodeContents(element);
		const selection = getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await assistantMessage.getByRole('button', { name: 'Add selected text to prompt' }).click();
	const reviewContext = page.getByLabel('Pending review context');
	await expect(reviewContext).toContainText('Inspected.');
	await reviewContext.getByLabel('Review comment').fill('Expand this finding.');
	await expect(reviewContext.getByLabel('Review comment')).toHaveValue('Expand this finding.');
	const fork = userMessage.getByRole('button', { name: 'Fork from this message unavailable' });
	await expect(fork).toBeDisabled();
	await expect(fork).toHaveAttribute(
		'title',
		'Hermes ACP can duplicate a full Session but cannot fork from a selected message'
	);
});

test('shows a live timer beside each busy session', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	const busySince = new Date(Date.now() - 50_000).toISOString();
	await page.route('**/api/projects/*/sessions', (route) =>
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

	for (const viewport of viewports) {
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

test('discovers Hermes slash commands and sends an attached image', async ({ page }, testInfo) => {
	let envelope: { text: string; images: Array<{ name: string; mimeType: string; data: string }> };
	let selectedModel = 'openai:gpt-5.6';
	let selectedReasoning = 'balanced';
	let selectedMode = 'default';
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'session-rich', cwd: '/work/hue', title: 'Rich input' }] }
		})
	);
	await page.route(/\/sessions\/session-rich$/, async (route) => {
		if (route.request().method() === 'PATCH') {
			const update = (await route.request().postDataJSON()) as {
				modelId?: string;
				modeId?: string;
				configId?: string;
				configValue?: string;
			};
			if (update.modelId) selectedModel = update.modelId;
			if (update.modeId) selectedMode = update.modeId;
			if (update.configId === 'reasoning' && update.configValue)
				selectedReasoning = update.configValue;
			return route.fulfill({
				json: {
					runtime: {
						profile: 'default',
						models: {
							currentModelId: selectedModel,
							availableModels: [
								{
									modelId: 'openai:gpt-5.6',
									name: 'OpenAI work subscription · GPT 5.6'
								},
								{ modelId: 'openai:gpt-5.6-mini', name: 'GPT 5.6 Mini' },
								{ modelId: 'anthropic:claude', name: 'Claude' }
							]
						},
						modes: {
							currentModeId: selectedMode,
							availableModes: [
								{ id: 'default', name: 'Default' },
								{ id: 'accept-edits', name: 'Accept edits' },
								{ id: 'dont-ask', name: "Don't Ask" }
							]
						},
						configOptions: [
							{
								type: 'select',
								id: 'reasoning',
								name: 'Reasoning',
								category: 'thought_level',
								currentValue: selectedReasoning,
								options: [
									{ value: 'balanced', name: 'Balanced' },
									{ value: 'high', name: 'High' }
								]
							}
						]
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
					capabilities: {
						loadSession: true,
						promptImage: true,
						sessionList: true,
						sessionFork: true,
						sessionResume: false,
						commands: ['help', 'compress']
					},
					models: {
						currentModelId: 'openai:gpt-5.6',
						availableModels: [
							{
								modelId: 'openai:gpt-5.6',
								name: 'OpenAI work subscription · GPT 5.6'
							},
							{ modelId: 'openai:gpt-5.6-mini', name: 'GPT 5.6 Mini' },
							{ modelId: 'anthropic:claude', name: 'Claude' }
						]
					},
					modes: {
						currentModeId: selectedMode,
						availableModes: [
							{ id: 'default', name: 'Default' },
							{ id: 'accept-edits', name: 'Accept edits' },
							{ id: 'dont-ask', name: "Don't Ask" }
						]
					},
					configOptions: [
						{
							type: 'select',
							id: 'reasoning',
							name: 'Reasoning',
							category: 'thought_level',
							currentValue: selectedReasoning,
							options: [
								{ value: 'balanced', name: 'Balanced' },
								{ value: 'high', name: 'High' }
							]
						}
					],
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
	await sessionButton(page, 'Rich input').click();
	await expect(page.getByText('25%', { exact: true })).toBeVisible();
	const modelTrigger = page.getByLabel('Hermes model', { exact: true });
	const modelMenu = page.getByRole('dialog', { name: 'Choose Hermes model' });
	const reasoningTrigger = page.getByRole('button', { name: 'Reasoning' });
	const reasoningMenu = page.getByRole('dialog', { name: 'Choose reasoning' });
	const approvalsTrigger = page.getByRole('button', { name: 'Edit approvals' });
	const approvalsMenu = page.getByRole('dialog', { name: 'Choose edit approvals' });
	const moreOptions = page.getByRole('button', { name: 'More session options' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await openComposerOptions(page);
	await page.getByRole('button', { name: 'Prompt library' }).click();
	const promptLibrary = page.getByRole('dialog', { name: 'Prompt library' });
	await expect(promptLibrary).toBeVisible();
	await promptLibrary.getByRole('button', { name: 'Close prompt library' }).click();
	await expect(modelTrigger).toHaveText(/gpt-5\.6/);
	await expect(modelTrigger).not.toContainText('OpenAI');
	await expect(modelTrigger).not.toContainText('subscription');
	const composerViewports = [
		...viewports.slice(0, 2),
		{ width: 768, height: 1024 },
		...viewports.slice(2)
	];
	for (const viewport of composerViewports) {
		await page.setViewportSize(viewport);
		if (viewport.width === 768) {
			const browserToggle = page
				.getByRole('navigation', { name: 'Project tools' })
				.getByRole('button', { name: 'Browser' });
			if ((await browserToggle.getAttribute('aria-expanded')) === 'true')
				await browserToggle.click();
		}
		if (viewport.width > 700 && viewport.width <= 1024) {
			await expect(moreOptions).toBeVisible();
			await expect(page.getByRole('button', { name: 'Prompt library' })).toBeHidden();
		}
		const context = page.getByLabel('Hermes session context');
		await context.evaluate((element) => (element.scrollLeft = 0));
		expect(await context.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
			await context.evaluate((element) => element.clientWidth)
		);
		const [contextBox, visibleModelBox] = await Promise.all([
			context.boundingBox(),
			modelTrigger.boundingBox()
		]);
		expect(visibleModelBox!.x).toBeGreaterThanOrEqual(contextBox!.x);
		expect(visibleModelBox!.x + visibleModelBox!.width).toBeLessThanOrEqual(
			contextBox!.x + contextBox!.width
		);
		const triggerBox = await modelTrigger.boundingBox();
		expect(triggerBox!.width).toBeLessThanOrEqual(150);
		expect(await modelTrigger.evaluate((element) => element.scrollHeight)).toBeLessThanOrEqual(
			triggerBox!.height
		);
		await modelTrigger.click();
		await expect(modelMenu).toBeVisible();
		const box = await modelMenu.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
		if (viewport.width <= 390) await expectMinimumTouchTargets(modelMenu.locator('button'));
		await page.keyboard.press('Escape');
		await expect(modelMenu).toBeHidden();
		const surface = await openComposerOptions(page);
		if (viewport.width > 700 && viewport.width <= 1024) {
			const menu = surface.getByLabel('Secondary session options');
			await expect(menu).toBeVisible();
			const [composerBox, menuBox] = await Promise.all([
				surface.locator('.composer').boundingBox(),
				menu.boundingBox()
			]);
			expect(menuBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
			expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
			await testInfo.attach(`composer-options-${viewport.width}x${viewport.height}`, {
				body: await page.screenshot(),
				contentType: 'image/png'
			});
		}
		await reasoningTrigger.click();
		await expect(reasoningMenu).toBeVisible();
		await expect(reasoningMenu.getByRole('button', { name: /Balanced/ })).toBeVisible();
		await expect(reasoningMenu.getByRole('button', { name: /High/ })).toBeVisible();
		await page.keyboard.press('Escape');
		await openComposerOptions(page);
		await approvalsTrigger.click();
		await expect(approvalsMenu).toBeVisible();
		await expect(approvalsMenu.getByRole('button', { name: /Default/ })).toBeVisible();
		await expect(approvalsMenu.getByRole('button', { name: /Accept edits/ })).toBeVisible();
		await expect(approvalsMenu.getByRole('button', { name: /Don't Ask/ })).toBeVisible();
		const approvalIcons = await approvalsMenu
			.locator('button > svg')
			.evaluateAll((icons) => icons.map((icon) => icon.innerHTML));
		expect(new Set(approvalIcons).size).toBe(3);
		await page.keyboard.press('Escape');
		await expect(approvalsMenu).toBeHidden();
		if (viewport.width <= 390) {
			const composer = page.locator('.composer');
			const attach = page.getByLabel('Attach images and files');
			const voiceMessage = page.getByRole('button', { name: 'Record voice message' });
			const voiceCall = page.getByRole('button', { name: 'Start voice call' });
			const workMode = page.getByRole('button', { name: 'Work mode' });
			const send = page.getByRole('button', { name: 'Send', exact: true });
			await expect(moreOptions).toBeVisible();
			await expect(attach).toBeHidden();
			await expect(voiceMessage).toBeHidden();
			await expect(voiceCall).toBeHidden();
			await expect(modelTrigger).toBeVisible();
			await expect(workMode).toBeVisible();
			await expect(send).toBeVisible();
			const [composerBox, contextBox, moreBox, modelBox, workModeBox, sendBox] = await Promise.all([
				composer.boundingBox(),
				context.boundingBox(),
				moreOptions.boundingBox(),
				modelTrigger.boundingBox(),
				workMode.boundingBox(),
				send.boundingBox()
			]);
			expect(composerBox!.height).toBeLessThanOrEqual(300);
			expect((await page.getByLabel('Message Hermes').boundingBox())!.height).toBeLessThanOrEqual(
				160
			);
			expect(moreBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
			expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(modelBox!.x);
			expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(workModeBox!.x);
			expect(contextBox!.y).toBe(workModeBox!.y);
			expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
			await expectMinimumTouchTargets(
				composer.locator('.composer-more, .context-chip, .composer-send')
			);
			await moreOptions.click();
			await expect(attach).toBeVisible();
			await expect(voiceMessage).toBeVisible();
			await expect(voiceCall).toBeVisible();
			const menu = page.getByLabel('Secondary session options');
			const menuBox = await menu.boundingBox();
			expect(menuBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
			expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
			await expectMinimumTouchTargets(menu.locator('button, label'));
			await page.keyboard.press('Escape');
		}
	}
	if (!(await reasoningTrigger.isVisible())) await moreOptions.click();
	await reasoningTrigger.click();
	await reasoningMenu.getByRole('button', { name: /High/ }).click();
	await expect.poll(() => selectedReasoning).toBe('high');
	await expect(reasoningTrigger).toHaveAttribute('title', /High/);
	if (!(await approvalsTrigger.isVisible())) await moreOptions.click();
	await approvalsTrigger.click();
	await approvalsMenu.getByRole('button', { name: /Accept edits/ }).click();
	await expect.poll(() => selectedMode).toBe('accept-edits');
	await expect(approvalsTrigger).toHaveAttribute('title', /Accept edits/);
	if (!(await page.getByLabel('Hermes profile: default').isVisible())) await moreOptions.click();
	await expect(page.getByLabel('Hermes profile: default')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Prompt library' })).toBeVisible();
	await page.getByRole('button', { name: 'Session settings for Rich input' }).click();
	const sessionOptions = page.getByRole('dialog', { name: 'Session options' });
	await expect(sessionOptions.getByLabel('Hermes profile')).toHaveCount(0);
	await expect(sessionOptions.getByRole('button', { name: /Prompt library/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Close session options' }).click();
	await modelTrigger.click();
	await expect(modelMenu.getByText('OpenAI', { exact: true })).toBeVisible();
	await expect(modelMenu.getByText('2 models', { exact: true })).toBeVisible();
	await modelMenu.getByText('Anthropic', { exact: true }).click();
	await modelMenu.getByRole('button', { name: /Claude/ }).click();
	await expect.poll(() => selectedModel).toBe('anthropic:claude');
	await expect(modelMenu).toBeHidden();
	await expect(modelTrigger).toContainText('claude');
	await expect(modelTrigger).toHaveAttribute('title', /Claude · anthropic:claude/);
	await page.getByLabel('Message Hermes').fill('/');
	await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toBeVisible();
	await expect(page.getByRole('option', { name: /compress/ })).toContainText(
		'Compress conversation context'
	);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toBeVisible();
		await expect(modelTrigger).toBeVisible();
		await page.getByRole('button', { name: 'Session settings for Rich input' }).click();
		await expect(page.getByRole('dialog', { name: 'Session options' })).toBeVisible();
		await page.getByRole('button', { name: 'Close session options' }).click();
		if (viewport.width <= 700) {
			await moreOptions.click();
			await expect(page.getByRole('button', { name: 'Reasoning' })).toBeVisible();
			await page.keyboard.press('Escape');
		} else await expect(page.getByText('25%', { exact: true })).toBeVisible();
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

	const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	await page.getByLabel('Attach images and files').setInputFiles({
		name: 'screen.png',
		mimeType: 'image/png',
		buffer: imageBytes
	});
	await expect(page.getByRole('img', { name: 'screen.png' })).toBeVisible();
	await page.getByLabel('Message Hermes').fill('Review this screenshot');
	await page.getByLabel('Message Hermes').press('Enter');

	expect(envelope!.text).toBe('Review this screenshot');
	expect(envelope!.images[0]).toMatchObject({ name: 'screen.png', mimeType: 'image/png' });
	expect(Buffer.from(envelope!.images[0].data, 'base64')).toEqual(imageBytes);
	expect(browserErrors).toEqual([]);
});

test('runs Workspace commands without disclosing or clearing staged draft attachments', async ({
	page
}) => {
	let envelope!: {
		text: string;
		images: unknown[];
		attachments: unknown[];
	};
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'command', cwd: '/work/hue', title: 'Command' }] }
		})
	);
	await page.route(/\/sessions\/command$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				commands: [{ name: 'help', description: 'List available commands' }]
			}
		})
	);
	await page.route(/\/sessions\/command\/messages$/, async (route) => {
		envelope = (await route.request().postDataJSON()) as typeof envelope;
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/command\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await sessionButton(page, 'Command').click();
	const surface = await openComposerOptions(page);
	await surface.locator('.composer input[type="file"]').setInputFiles({
		name: 'draft.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('private draft attachment')
	});
	await expect(page.getByText('draft.txt')).toBeVisible();
	await openHermesSettings(page);
	await page
		.getByRole('region', { name: 'Settings' })
		.locator('.settings-grid')
		.getByRole('button', { name: /Commands/ })
		.click();
	await page
		.getByRole('region', { name: 'Hermes management' })
		.getByRole('button', { name: /help/ })
		.click();

	expect(envelope).toEqual({
		messageId: expect.any(String),
		text: '/help',
		images: [],
		attachments: [],
		reviewContexts: []
	});
	await expect(page.getByText('draft.txt')).toBeVisible();
});

test('mod-enter sends command text while plain Enter completes selected command', async ({
	page
}) => {
	const envelopes: Array<{ text: string }> = [];
	await page.addInitScript(() => {
		localStorage.setItem('hue:preferences', JSON.stringify({ sendKey: 'mod-enter' }));
	});
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'command-keys', cwd: '/work/hue', title: 'Command keys' }] }
		})
	);
	await page.route(/\/sessions\/command-keys$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				commands: [{ name: 'help', description: 'List available commands' }]
			}
		})
	);
	await page.route(/\/sessions\/command-keys\/messages$/, async (route) => {
		envelopes.push((await route.request().postDataJSON()) as { text: string });
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/command-keys\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);

	await addProject(page);
	await sessionButton(page, 'Command keys').click();
	const composer = page.getByLabel('Message Hermes');
	await composer.fill('/he');
	await composer.press('Enter');
	await expect(composer).toHaveValue('/help ');
	expect(envelopes).toHaveLength(0);

	await composer.fill('/he');
	await composer.press('ControlOrMeta+Enter');
	await expect.poll(() => envelopes).toHaveLength(1);
	expect(envelopes[0].text).toBe('/he');
});

test('keeps generic attachment bytes transient and restores explicit reattach plus MEDIA controls', async ({
	page
}, testInfo) => {
	let sent = false;
	let posts = 0;
	let envelope: {
		attachments: Array<{ name: string; mimeType: string; size: number; data: string }>;
	};
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'files', cwd: '/work/hue', title: 'Files' }] }
		})
	);
	await page.route(/\/sessions\/files$/, (route) =>
		route.fulfill({
			json: sent
				? {
						transcript: [
							{ role: 'user', text: 'Review notes' },
							{
								role: 'assistant',
								text: 'Reviewed.\nMEDIA: output/report.pdf\nMEDIA: output/screenshot.png\nMEDIA: output/diagram.svg'
							}
						],
						messages: [
							{
								id: 'file-message',
								text: 'Review notes',
								status: 'completed',
								createdAt: '2026-08-22T10:00:00Z',
								attachments: [
									{
										name: 'notes.txt',
										mimeType: 'text/plain',
										size: 5,
										available: false,
										reattachRequired: true
									}
								]
							}
						],
						events: [
							{
								sequence: 1,
								type: 'message.accepted',
								payload: { messageId: 'file-message' },
								createdAt: '2026-08-22T10:00:00Z'
							},
							{
								sequence: 2,
								type: 'message.running',
								payload: { messageId: 'file-message' },
								createdAt: '2026-08-22T10:00:01Z'
							},
							{
								sequence: 3,
								type: 'agent.chunk',
								payload: {
									messageId: 'file-message',
									text: 'Reviewed.\nMEDIA: output/report.pdf\nMEDIA: output/screenshot.png\nMEDIA: output/diagram.svg'
								},
								createdAt: '2026-08-22T10:00:02Z'
							},
							{
								sequence: 4,
								type: 'message.completed',
								payload: { messageId: 'file-message' },
								createdAt: '2026-08-22T10:00:03Z'
							}
						],
						cursor: 4,
						activeTurn: null
					}
				: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route(/\/sessions\/files\/messages$/, async (route) => {
		posts += 1;
		envelope = (await route.request().postDataJSON()) as typeof envelope;
		sent = true;
		return route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/files\/events\?after=0$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route(/\/sessions\/files\/media\?.*$/, (route) => {
		const path = new URL(route.request().url()).searchParams.get('path');
		if (path?.endsWith('.svg'))
			return route.fulfill({
				headers: {
					'content-type': 'image/svg+xml',
					'x-content-type-options': 'nosniff',
					'content-security-policy': "default-src 'none'; script-src 'none'; sandbox"
				},
				body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="blue"/></svg>'
			});
		if (path?.endsWith('.png'))
			return route.fulfill({
				headers: { 'content-type': 'image/png' },
				body: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
					'base64'
				)
			});
		const bytes = Buffer.from('%PDF-1.7\nrange');
		const range = route.request().headers().range;
		if (range)
			return route.fulfill({
				status: 206,
				headers: {
					'accept-ranges': 'bytes',
					'content-range': `bytes 5-11/${bytes.length}`,
					'content-type': 'application/pdf'
				},
				body: bytes.subarray(5, 12)
			});
		return route.fulfill({
			headers: { 'accept-ranges': 'bytes', 'content-type': 'application/pdf' },
			body: bytes
		});
	});

	await addProject(page);
	await sessionButton(page, 'Files').click();
	await page.locator('.composer input[type="file"]').setInputFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('hello')
	});
	await expect(page.getByLabel('Pending file attachments')).toContainText('notes.txt');
	await page.getByLabel('Message Hermes').fill('Review notes');
	await page.getByLabel('Message Hermes').press('Enter');
	expect(Buffer.from(envelope!.attachments[0].data, 'base64').toString()).toBe('hello');
	await expect(page.getByText('Reattach required')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Download notes.txt' })).toHaveCount(0);

	await page.reload();
	await expect(page.getByText('Reattach required')).toBeVisible();
	await page
		.locator('.transcript article.user')
		.getByRole('button', { name: 'Edit and resend message' })
		.click();
	await expect(page.getByRole('alert')).toContainText('reattach files');
	await page.getByRole('button', { name: 'Retry last response' }).click();
	await expect(page.getByRole('alert')).toContainText('reattach files');
	expect(posts).toBe(1);

	const preview = page.getByRole('link', { name: 'Preview output/report.pdf' });
	const download = page.getByRole('link', { name: 'Download output/report.pdf' });
	const outputs = page.getByRole('region', { name: 'Generated outputs' });
	const image = page.getByRole('img', { name: 'screenshot.png' });
	const svg = page.getByRole('img', { name: 'diagram.svg' });
	await expect(outputs.getByLabel('Inline preview of report.pdf')).toBeVisible();
	const previewHref = (await preview.getAttribute('href'))!;
	await outputs.getByRole('button', { name: 'Select screenshot.png' }).click();
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute(
		'src',
		/\/sessions\/files\/media\?path=output%2Fscreenshot\.png$/
	);
	await outputs.getByRole('button', { name: 'Select diagram.svg' }).click();
	await expect(svg).toHaveAttribute('src', /\/sessions\/files\/media\?path=output%2Fdiagram\.svg$/);
	await outputs.getByRole('button', { name: 'Select report.pdf' }).click();
	await expect(preview).toHaveAttribute('target', '_blank');
	await expect(download).toHaveAttribute('href', /download=true/);
	const artifactsButton = page.getByRole('button', {
		name: 'Open artifacts gallery, 3 artifacts'
	});
	await expect(artifactsButton).toBeVisible();
	await artifactsButton.click();
	const artifactsGallery = page.getByRole('dialog', { name: 'Session artifacts gallery' });
	await expect(artifactsGallery).toBeVisible();
	await expect(artifactsGallery.getByText('1 / 3')).toBeVisible();
	await artifactsGallery.getByRole('link', { name: 'Download output/report.pdf' }).focus();
	await artifactsGallery
		.getByRole('link', { name: 'Download output/report.pdf' })
		.press('ArrowRight');
	await expect(artifactsGallery.getByText('1 / 3')).toBeVisible();
	await page.setViewportSize(viewports.at(-1)!);
	const artifactStrip = artifactsGallery.getByRole('navigation', { name: 'Artifacts' });
	const stripSize = await artifactStrip.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		children: [...element.children].map((child) => (child as HTMLElement).offsetWidth)
	}));
	expect(stripSize.scrollWidth).toBeGreaterThan(stripSize.clientWidth);
	await artifactStrip.evaluate((element) => (element.scrollLeft = element.scrollWidth));
	expect(await artifactStrip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await page.setViewportSize(viewports[0]);
	await expect(
		artifactsGallery.getByRole('img', { name: 'Thumbnail of screenshot.png' })
	).toBeVisible();
	await expect(
		artifactsGallery.getByRole('img', { name: 'Thumbnail of diagram.svg' })
	).toBeVisible();
	await artifactsGallery.getByRole('button', { name: 'Select diagram.svg' }).click();
	await expect(artifactsGallery.getByRole('img', { name: 'Preview of diagram.svg' })).toBeVisible();
	await artifactsGallery.getByRole('button', { name: 'Select report.pdf' }).click();
	await artifactsGallery.getByRole('button', { name: 'Next artifact' }).click();
	await expect(
		artifactsGallery.getByRole('img', { name: 'Preview of screenshot.png' })
	).toBeVisible();
	await artifactsGallery.getByRole('button', { name: 'Close artifacts gallery' }).click();
	await expect(artifactsGallery).not.toBeVisible();
	await expect(artifactsButton).toBeFocused();
	await outputs.getByRole('button', { name: 'Select screenshot.png' }).click();
	await page.getByRole('button', { name: 'Expand output/screenshot.png' }).click();
	const showcase = page.getByRole('dialog', { name: 'screenshot.png' });
	await expect(showcase).toBeVisible();
	await showcase.getByRole('button', { name: 'Zoom in' }).click();
	await expect(showcase.getByRole('img', { name: 'Preview of screenshot.png' })).toHaveAttribute(
		'style',
		/width: 125%/
	);
	await showcase.getByRole('button', { name: 'Close preview' }).click();
	await expect(showcase).not.toBeVisible();
	const ranged = await page.evaluate(async (href) => {
		const response = await fetch(href, {
			headers: { range: 'bytes=5-11' }
		});
		return { status: response.status, contentRange: response.headers.get('content-range') };
	}, previewHref);
	expect(ranged.status).toBe(206);
	expect(ranged.contentRange).toMatch(/^bytes 5-11\//);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await page.getByRole('button', { name: 'Expand output/screenshot.png' }).click();
		await expect(showcase).toBeVisible();
		const box = await showcase.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(
				page.locator('[aria-label="Generated outputs"] a, [aria-label="Generated outputs"] button')
			);
			await expectMinimumTouchTargets(showcase.locator('header a, header button'));
		}
		await testInfo.attach(`selected-artifact-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await showcase.getByRole('button', { name: 'Close preview' }).click();
	}
	await page.getByLabel('Message Hermes').focus();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
});

test('previews CSV and sandboxed interactive HTML outputs inline', async ({ page }, testInfo) => {
	const errors: string[] = [];
	const csvRanges: string[] = [];
	page.on(
		'console',
		(message) =>
			message.type() === 'error' &&
			!message.text().startsWith('Blocked script execution in') &&
			errors.push(message.text())
	);
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'preview-formats', cwd: '/work/hue', title: 'Formats' }] }
		})
	);
	await page.route(/\/sessions\/preview-formats$/, (route) =>
		route.fulfill({
			json: {
				transcript: [
					{
						role: 'assistant',
						text: 'Outputs ready.\nMEDIA: output/report.csv\nMEDIA: output/empty.csv\nMEDIA: output/dashboard.html'
					}
				],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);
	await page.route(/\/sessions\/preview-formats\/media\?.*$/, (route) => {
		const path = new URL(route.request().url()).searchParams.get('path');
		if (path?.endsWith('.html'))
			return route.fulfill({
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-security-policy':
						"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; sandbox"
				},
				body: '<details><summary>Dashboard controls</summary><label>Scenario <input></label></details><script>document.body.dataset.script="unsafe"</script>'
			});
		csvRanges.push(route.request().headers().range ?? '');
		return route.fulfill({
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'content-disposition': 'inline; filename="report.csv"'
			},
			body: path?.endsWith('empty.csv') ? '' : 'name,value\nHermes,ready\n'
		});
	});

	await addProject(page);
	await sessionButton(page, 'Formats').click();
	const outputs = page.getByRole('region', { name: 'Generated outputs' });
	await expect(outputs.locator('.generated-output-preview')).toHaveCount(1);
	await expect(outputs.getByRole('button', { name: 'Select report.csv' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const csv = outputs.getByRole('table', { name: 'Preview of report.csv' });
	await expect(csv).toBeVisible();
	await expect(csv.getByRole('columnheader', { name: 'name' })).toBeVisible();
	await expect(csv.getByRole('cell', { name: 'ready' })).toBeVisible();
	expect(csvRanges).toContain('bytes=0-999999');
	await expect(outputs.locator('.generated-output-toolbar svg')).toHaveCount(5);
	await outputs.getByRole('button', { name: 'Expand output/report.csv' }).click();
	const csvShowcase = page.getByRole('dialog', { name: 'report.csv' });
	await expect(csvShowcase.getByRole('table', { name: 'Preview of report.csv' })).toBeVisible();
	await csvShowcase.getByRole('button', { name: 'Close preview' }).click();
	await outputs.getByRole('button', { name: 'Select empty.csv' }).click();
	await expect(outputs.getByText('CSV file is empty.')).toBeVisible();
	await outputs.getByRole('button', { name: 'Select dashboard.html' }).click();
	const html = outputs.getByLabel('Inline preview of dashboard.html');
	await expect(html).toBeVisible();
	await expect(html).toHaveAttribute('sandbox', '');
	await expect(html.contentFrame().locator('body')).not.toHaveAttribute('data-script', 'unsafe');
	const details = html.contentFrame().locator('details');
	expect(
		await details.evaluate((element) => {
			element.querySelector('summary')?.click();
			return (element as HTMLDetailsElement).open;
		})
	).toBe(true);
	await html.contentFrame().getByLabel('Scenario').fill('Release');
	await expect(html.contentFrame().getByLabel('Scenario')).toHaveValue('Release');
	expect(errors).toEqual([]);
	await expect(
		page.getByRole('button', { name: 'Open output/dashboard.html', exact: true })
	).toHaveCount(0);

	const artifactsButton = page.getByRole('button', {
		name: 'Open artifacts gallery, 3 artifacts'
	});
	await artifactsButton.click();
	const gallery = page.getByRole('dialog', { name: 'Session artifacts gallery' });
	await expect(
		gallery.getByRole('button', { name: 'Select report.csv' }).locator('iframe')
	).toHaveCount(0);
	const galleryCsv = gallery.getByRole('table', { name: 'Preview of report.csv' });
	await expect(galleryCsv).toBeVisible();
	await expect(galleryCsv.getByRole('columnheader', { name: 'name' })).toBeVisible();
	await expect(galleryCsv.getByRole('cell', { name: 'ready' })).toBeVisible();
	await gallery.getByRole('button', { name: 'Select dashboard.html' }).click();
	await expect(gallery.getByTitle('Preview of dashboard.html')).toHaveAttribute('sandbox', '');
	await gallery.getByRole('button', { name: 'Close artifacts gallery' }).click();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await outputs.getByRole('button', { name: 'Select report.csv' }).click();
		await expect(csv).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await testInfo.attach(`csv-preview-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await outputs.getByRole('button', { name: 'Select dashboard.html' }).click();
		await expect(html).toBeVisible();
		await testInfo.attach(`format-previews-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}
	expect(errors).toEqual([]);
});

test('queues and edits messages with attachments while streaming, then can send now or stop', async ({
	page
}) => {
	let queued: { messageId: string; text: string; attachments?: Array<{ data: string }> } | null =
		null;
	let edited = '';
	let preservedAttachment = false;
	let cancellations = 0;
	await page.route('**/api/projects/*/sessions', (route) =>
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
		const body = (await route.request().postDataJSON()) as {
			messageId: string;
			text: string;
			attachments?: Array<{ data: string }>;
			preserveAttachments?: boolean;
		};
		if (route.request().method() === 'PATCH') {
			edited = body.text;
			preservedAttachment = body.preserveAttachments === true && body.attachments === undefined;
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
	await sessionButton(page, 'Queue').click();
	const surface = await openComposerOptions(page);
	await expect(surface.getByLabel('Message Hermes')).toBeEnabled();
	await expect(surface.getByRole('button', { name: 'Stop' })).toBeVisible();
	await expect(surface.getByRole('button', { name: 'Edit approvals' })).toHaveCSS(
		'border-top-width',
		'1px'
	);
	await surface.locator('.composer input[type="file"]').setInputFiles({
		name: 'queued.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('queue bytes')
	});
	await expect(page.getByLabel('Pending file attachments')).toContainText('queued.txt');
	await page.getByLabel('Message Hermes').fill('Follow up');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect(page.getByRole('region', { name: 'Queued messages' })).toContainText('Follow up');
	await page.getByRole('button', { name: 'Edit queued message' }).click();
	await page.getByLabel('Message Hermes').fill('Edited follow up');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect.poll(() => edited).toBe('Edited follow up');
	expect(preservedAttachment).toBe(true);
	await page.getByRole('button', { name: 'Send queued message now' }).click();
	await expect.poll(() => cancellations).toBe(1);
	await expect(surface.getByRole('button', { name: 'Cancelling', exact: true })).toBeDisabled();
});

test('shows durable delegate_task children as a collapsible status and result tree', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/projects/*/sessions', (route) =>
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
	await sessionButton(page, 'Agents').click();
	const surface = primarySessionSurface(page);
	await surface.getByRole('button', { name: 'Thinking' }).click();
	const tree = page
		.getByLabel('Thinking timeline')
		.getByRole('article')
		.filter({ hasText: 'Map moved path references' });
	await expect(tree).toBeVisible();
	await expect(tree.getByText('Map moved path references')).toBeVisible();
	await expect(tree.getByText('failed', { exact: true })).toBeVisible();
	await expect(tree.getByText('Found three references.')).toBeVisible();
	await surface.getByRole('button', { name: 'Thinking' }).click();
	await expect(tree.getByText('Map moved path references')).toBeHidden();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(tree.locator('summary'));
	}
	expect(browserErrors).toEqual([]);
});

test('keeps chat clean while Thinking dialog and current task preserve ACP activity', async ({
	page
}, testInfo) => {
	const responses: unknown[] = [];
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'session-error',
						cwd: '/work/hue',
						title: 'Failed background task',
						attention: false,
						error: true
					},
					{
						sessionId: 'session-interactions',
						cwd: '/work/hue',
						title: 'Interactions',
						attention: true,
						error: false
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-interactions$/, (route) =>
		route.fulfill({
			json: {
				transcript: [
					{ role: 'user', text: 'Inspect safely' },
					{ role: 'assistant', text: 'Before tool.```ts\nconst safe = true;\n```' }
				],
				messages: [
					{
						id: 'msg-1',
						status: 'running',
						text: 'Inspect safely',
						images: [],
						createdAt: '2026-08-22T09:59:59.000Z'
					}
				],
				runtime: { profile: 'default', clarify: { status: 'available' } },
				cursor: 12,
				activeTurn: {
					messageId: 'msg-1',
					status: 'running',
					thought: 'Private published reasoning',
					output: '',
					error: null
				},
				events: [
					{
						sequence: 1,
						type: 'message.accepted',
						createdAt: '2026-08-22T09:59:59.050Z',
						payload: { messageId: 'msg-1' }
					},
					{
						sequence: 2,
						type: 'agent.chunk',
						createdAt: '2026-08-22T10:00:00.000Z',
						payload: { messageId: 'msg-1', text: 'Before tool.' }
					},
					{
						sequence: 3,
						type: 'agent.tool',
						createdAt: '2026-08-22T10:00:00.000Z',
						payload: {
							messageId: 'msg-1',
							id: 'tool-1',
							name: 'read_file',
							title: 'Read configuration',
							status: 'completed',
							args: { path: 'config.json', apiKey: '[REDACTED]' },
							result: { ok: true },
							durationMs: 425
						}
					},
					{
						sequence: 4,
						type: 'agent.tool',
						payload: {
							messageId: 'msg-1',
							id: 'tool-1',
							name: 'read_file',
							title: 'Read configuration',
							status: 'completed',
							result: { ok: true },
							durationMs: 425
						}
					},
					{
						sequence: 5,
						type: 'agent.chunk',
						payload: { messageId: 'msg-1', text: '```ts\nconst safe = true;\n```' }
					},
					{
						sequence: 6,
						type: 'agent.plan',
						payload: {
							messageId: 'msg-1',
							entries: [
								{ content: 'Inspect files', priority: 'high', status: 'completed' },
								{ content: 'Run checks', priority: 'medium', status: 'in_progress' }
							]
						}
					},
					{
						sequence: 7,
						type: 'agent.permission',
						createdAt: '2026-08-22T10:00:01.000Z',
						payload: {
							messageId: 'msg-1',
							id: 'perm-1',
							status: 'pending',
							toolCall: { title: 'Execute test suite', args: { command: 'bun test' } },
							options: [
								{ optionId: 'once', name: 'Allow once', kind: 'allow_once' },
								{ optionId: 'session', name: 'Allow for session', kind: 'allow_always' },
								{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }
							]
						}
					},
					{
						sequence: 8,
						type: 'agent.clarify',
						createdAt: '2026-08-22T10:00:02.000Z',
						payload: {
							messageId: 'msg-1',
							id: 'clarify-1',
							status: 'pending',
							message: 'Choose deployment',
							fields: [
								{
									name: 'target',
									label: 'Target',
									control: 'single',
									required: true,
									options: [
										{ value: 'staging', label: 'Staging' },
										{ value: 'production', label: 'Production' }
									]
								},
								{
									name: 'checks',
									label: 'Checks',
									control: 'multi',
									required: false,
									options: [{ value: 'e2e', label: 'E2E' }]
								},
								{ name: 'note', label: 'Note', control: 'text', required: false }
							]
						}
					},
					{
						sequence: 9,
						type: 'agent.clarify',
						createdAt: '2026-08-22T10:00:03.000Z',
						payload: {
							messageId: 'msg-1',
							id: 'clarify-cancel',
							status: 'pending',
							message: 'Add optional detail',
							fields: [{ name: 'detail', label: 'Detail', control: 'text', required: false }]
						}
					},
					{
						sequence: 10,
						type: 'agent.thought',
						createdAt: '2026-08-22T10:00:04.000Z',
						payload: { messageId: 'msg-1', text: 'Private published reasoning' }
					},
					{
						sequence: 11,
						type: 'agent.subagents',
						createdAt: '2026-08-22T10:00:05.000Z',
						payload: {
							messageId: 'msg-1',
							id: 'delegate-1',
							title: '1 subagent',
							status: 'completed',
							children: [
								{ index: 0, goal: 'Inspect fixtures', status: 'completed', result: 'Ready' }
							]
						}
					},
					{
						sequence: 12,
						type: 'session.work_mode_changed',
						createdAt: '2026-08-22T10:00:06.000Z',
						payload: { priorMode: 'autonomous', workMode: 'live', source: 'user' }
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-interactions\/events\?after=12$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route(/\/sessions\/session-interactions\/interactions$/, async (route) => {
		responses.push(await route.request().postDataJSON());
		await route.fulfill({ json: { resolved: true } });
	});

	await addProject(page);
	await expect(sessionButton(page, 'Failed background task')).toHaveAccessibleName(
		'Failed background task, Failed'
	);
	await expect(sessionButton(page, 'Interactions').getByLabel(/attention/i)).toBeVisible();
	await sessionButton(page, 'Interactions').click();
	await page.getByRole('button', { name: /Inspect Session context/ }).click();
	await expect(page.getByRole('dialog', { name: 'Session inspector' })).toContainText(
		/Clarification capability\s+Available/
	);
	await page.getByRole('button', { name: 'Close Session inspector' }).click();
	expect(
		await page
			.locator('.transcript [data-timeline-sequence]')
			.evaluateAll((elements) =>
				elements.map((element) => Number(element.getAttribute('data-timeline-sequence')))
			)
	).toEqual([1, 2, 5, 7, 8, 9]);
	await expect(page.getByRole('button', { name: 'Thinking' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toHaveAttribute(
		'title',
		/1\/2/
	);
	const composer = primarySessionSurface(page).locator('.composer');
	for (const trigger of [
		page.getByRole('button', { name: 'Thinking' }),
		page.getByRole('button', { name: 'Tasks', exact: true })
	]) {
		const triggerBox = (await trigger.boundingBox())!;
		const composerBox = (await composer.boundingBox())!;
		expect(triggerBox.x).toBeGreaterThanOrEqual(composerBox.x);
		expect(triggerBox.y).toBeGreaterThanOrEqual(composerBox.y);
		expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(composerBox.x + composerBox.width);
		expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(
			composerBox.y + composerBox.height
		);
	}
	const conversationTimes = page.locator('.transcript article time');
	await expect(conversationTimes).toHaveCount(2);
	await expect(conversationTimes.first()).toHaveAttribute('datetime', '2026-08-22T09:59:59.000Z');
	await expect(conversationTimes.last()).toHaveAttribute('datetime', '2026-08-22T10:00:00.000Z');
	for (const time of await conversationTimes.all()) {
		await expect(time).toHaveText(/^\d{2}:\d{2}$/);
		await expect(time).toHaveAttribute('title', /2026/);
	}
	const thinkingTrigger = page.getByRole('button', { name: 'Thinking' });
	const taskTrigger = page.getByRole('button', { name: 'Tasks', exact: true });
	await thinkingTrigger.click();
	const thinking = page.getByLabel('Thinking timeline');
	await expect(thinking).toBeVisible();
	expect(
		await thinking
			.locator('.thinking-event')
			.first()
			.evaluate((element) => getComputedStyle(element).display)
	).toBe('grid');
	expect(
		await thinking
			.locator('[data-thinking-sequence]')
			.evaluateAll((elements) =>
				elements.map((element) => Number(element.getAttribute('data-thinking-sequence')))
			)
	).toEqual([3, 10, 11, 12]);
	await expect(thinking.getByText('Inspect fixtures')).toBeVisible();
	await expect(thinking.getByText('Work mode changed to Live')).toBeVisible();
	await thinking.evaluate((element) => {
		const growth = document.createElement('div');
		growth.style.height = '500px';
		element.firstElementChild?.append(growth);
	});
	await expect
		.poll(() =>
			thinking.evaluate(
				(element) => element.scrollHeight - element.scrollTop - element.clientHeight
			)
		)
		.toBeLessThan(2);
	await thinking.evaluate((element) => {
		element.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
		element.scrollTop = 0;
		element.dispatchEvent(new Event('scroll'));
	});
	await expect(page.getByRole('button', { name: 'Scroll to latest progress' })).toBeVisible();
	const releasedProgressTop = await thinking.evaluate((element) => element.scrollTop);
	await thinking.evaluate((element) => {
		const growth = document.createElement('div');
		growth.style.height = '200px';
		element.firstElementChild?.append(growth);
	});
	await page.waitForTimeout(50);
	expect(await thinking.evaluate((element) => element.scrollTop)).toBe(releasedProgressTop);
	await page.getByRole('button', { name: 'Scroll to latest progress' }).click();
	await expect
		.poll(() =>
			thinking.evaluate(
				(element) => element.scrollHeight - element.scrollTop - element.clientHeight
			)
		)
		.toBeLessThan(2);
	const toolGroup = thinking.getByRole('group', { name: 'Read configuration' });
	const toolSummary = toolGroup.locator('summary');
	await toolSummary.focus();
	await toolSummary.press('Enter');
	await expect(toolGroup).toContainText('[REDACTED]');
	await expect(thinking.getByText('Private published reasoning')).toBeVisible();
	await thinkingTrigger.click();
	await expect(thinking).toBeHidden();
	await taskTrigger.click();
	const taskList = page.locator('.current-task-entries');
	await expect(taskList).toContainText('Inspect files');
	await taskList.evaluate((element) => {
		const growth = document.createElement('div');
		growth.style.height = '500px';
		element.firstElementChild?.append(growth);
	});
	await expect
		.poll(() =>
			taskList.evaluate(
				(element) => element.scrollHeight - element.scrollTop - element.clientHeight
			)
		)
		.toBeLessThan(2);
	await taskList.evaluate((element) => {
		element.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
		element.scrollTop = 0;
		element.dispatchEvent(new Event('scroll'));
	});
	await expect(page.getByRole('button', { name: 'Scroll to latest task' })).toBeVisible();
	await taskList.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event('scroll'));
	});
	await expect(page.getByRole('button', { name: 'Scroll to latest task' })).toBeHidden();
	await taskTrigger.click();
	await expect(
		page.getByRole('group', { name: 'Permission required: Execute test suite' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
	await page.getByRole('button', { name: 'Allow for session' }).focus();
	await page.getByRole('button', { name: 'Allow for session' }).press('Enter');
	const clarify = page.getByRole('group', { name: 'Clarify: Choose deployment' });
	await clarify.getByLabel('Staging').check();
	await clarify.getByLabel('E2E').check();
	await clarify.getByLabel('Note').fill('Go');
	await clarify.getByRole('button', { name: 'Submit answer' }).click();
	await page
		.getByRole('group', { name: 'Clarify: Add optional detail' })
		.getByRole('button', { name: 'Cancel' })
		.click();
	await expect.poll(() => responses.length).toBe(3);
	await expect(page.getByText('Private published reasoning')).toBeHidden();
	await page.getByRole('button', { name: 'Copy code' }).focus();
	await page.getByRole('button', { name: 'Copy code' }).press('Enter');
	await expect(page.getByText('Code copied')).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(page.locator('.composer button, .code-block button'));
		if (viewport.width <= 390) {
			const moreBox = (await page
				.getByRole('button', { name: 'More session options' })
				.boundingBox())!;
			for (const activity of [thinkingTrigger, taskTrigger]) {
				const activityBox = (await activity.boundingBox())!;
				expect(Math.abs(activityBox.y - moreBox.y)).toBeLessThanOrEqual(1);
			}
		}
		await taskTrigger.click();
		await expect(taskList).toBeVisible();
		const taskBox = (await taskList.boundingBox())!;
		expect(taskBox.width).toBeLessThanOrEqual((await composer.boundingBox())!.width);
		await testInfo.attach(`tasks-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await taskTrigger.click();
	}
	expect(browserErrors).toEqual([]);
});

test('omits unavailable historical conversation timestamps', async ({ page }) => {
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'history', cwd: '/work/hue', title: 'History' }] }
		})
	);
	await page.route(/\/sessions\/history$/, (route) =>
		route.fulfill({
			json: {
				transcript: [
					{ role: 'user', text: 'Undated message' },
					{
						role: 'assistant',
						text: 'Dated message',
						createdAt: '2026-08-22T10:00:00.000Z'
					}
				],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);

	await addProject(page);
	await sessionButton(page, 'History').click();
	const articles = page.locator('.transcript article');
	await expect(articles).toHaveCount(2);
	await expect(articles.first().locator('time')).toHaveCount(0);
	await expect(articles.last().locator('time')).toHaveAttribute(
		'datetime',
		'2026-08-22T10:00:00.000Z'
	);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
});

test('interaction completion stays with its captured Session across navigation', async ({
	page
}) => {
	let interactionStarted!: () => void;
	let finishInteraction!: () => void;
	let finishOriginRefresh!: () => void;
	const started = new Promise<void>((resolve) => (interactionStarted = resolve));
	const interaction = new Promise<void>((resolve) => (finishInteraction = resolve));
	const originRefresh = new Promise<void>((resolve) => (finishOriginRefresh = resolve));
	let originLoads = 0;
	const sessionBody = (title: string) => ({
		transcript: [],
		messages: [],
		runtime: { profile: 'default' },
		cursor: 1,
		activeTurn: null,
		events: [
			{
				sequence: 1,
				type: 'agent.permission',
				payload: {
					messageId: `message-${title}`,
					id: 'shared-interaction',
					status: 'pending',
					toolCall: { title },
					options: [{ optionId: 'allow', name: `Allow ${title}`, kind: 'allow_once' }]
				}
			}
		]
	});

	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'origin', cwd: '/work/hue', title: 'Origin Session' },
					{ sessionId: 'other', cwd: '/work/hue', title: 'Other Session' }
				]
			}
		})
	);
	await page.route(/\/sessions\/(origin|other)$/, async (route) => {
		const sessionId = new URL(route.request().url()).pathname.split('/').at(-1);
		if (sessionId === 'origin' && ++originLoads > 1) await originRefresh;
		await route.fulfill({
			json: sessionBody(sessionId === 'origin' ? 'Origin tool' : 'Other tool')
		});
	});
	await page.route(/\/sessions\/origin\/interactions$/, async (route) => {
		interactionStarted();
		await interaction;
		await route.fulfill({ json: { resolved: true } });
	});

	await addProject(page);
	await sessionButton(page, 'Origin Session').click();
	await page.getByRole('button', { name: 'Allow Origin tool' }).click();
	await started;
	await sessionButton(page, 'Other Session').click();
	await expect(page.getByRole('button', { name: 'Allow Other tool' })).toBeVisible();

	const completed = page.waitForResponse(/\/sessions\/origin\/interactions$/);
	finishInteraction();
	await completed;
	await expect(page.getByRole('button', { name: 'Allow Other tool' })).toBeVisible();
	await sessionButton(page, 'Origin Session').click();
	await primarySessionSurface(page).getByRole('button', { name: 'Thinking' }).click();
	const permission = page
		.getByLabel('Thinking timeline')
		.getByRole('article')
		.filter({ hasText: 'Origin tool' });
	await expect(permission).toContainText('Status: resolved');
	await expect(page.getByRole('button', { name: 'Allow Origin tool' })).toHaveCount(0);
	finishOriginRefresh();
});

test('shows loading without shifting the session list action or rows', async ({ page }) => {
	let finishSessionLoad = () => {};
	let sessionLoad = Promise.resolve();
	await page.route('**/api/projects/*/sessions', async (route) => {
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

	for (const viewport of viewports) {
		sessionLoad = new Promise<void>((resolve) => (finishSessionLoad = resolve));
		await page.setViewportSize(viewport);
		await addProject(page);
		await openMobileSessions(page);
		const session = sessionButton(page, 'Loading');
		await expect(session).toBeVisible();
		const before = await session.boundingBox();
		await session.click();
		if (viewport.width <= 700) {
			await expect(page).toHaveURL(/session=session-loading/);
			await expect(page.locator('#session-drawer')).toBeHidden();
			await openMobileSessions(page);
			await expect
				.poll(async () => (await page.locator('#session-drawer').boundingBox())?.x)
				.toBe(0);
		}

		const indicator = page.locator('[aria-label="Loading project contents"]');
		await expect(indicator).toBeVisible();
		expect(await indicator.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
			'none'
		);
		const during = await session.boundingBox();
		const addButton = await page
			.getByRole('button', { name: 'Add new session', exact: true })
			.boundingBox();
		expect(during?.y).toBe(before?.y);
		expect(addButton!.y).toBeLessThan(during!.y);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);

		finishSessionLoad();
		await expect(indicator).toHaveCount(0);
		expect((await session.boundingBox())?.y).toBe(before?.y);
	}
});

test('revisits a loaded session immediately while refreshing it', async ({ page }) => {
	await controlIdleCallbacks(page);
	let delayRefresh = false;
	let alphaRequests = 0;
	let releaseRefresh = () => {};
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'session-alpha', cwd: '/work/hue', title: 'Alpha' },
					{ sessionId: 'session-beta', cwd: '/work/hue', title: 'Beta' }
				]
			}
		})
	);
	await page.route(/\/sessions\/session-alpha$/, async (route) => {
		if (!new URL(route.request().url()).searchParams.has('cached')) alphaRequests += 1;
		if (delayRefresh) await new Promise<void>((resolve) => (releaseRefresh = resolve));
		await route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Alpha is ready' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		});
	});
	await page.route(/\/sessions\/session-beta$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Beta is ready' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);

	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	await sessionButton(page, 'Alpha').click();
	await expect(page.getByText('Alpha is ready')).toBeVisible();
	await sessionButton(page, 'Beta').click();
	await expect(page.getByText('Beta is ready')).toBeVisible();
	delayRefresh = true;
	await sessionButton(page, 'Alpha').click();
	await expect(page.getByText('Alpha is ready')).toBeVisible();
	await expect.poll(() => alphaRequests).toBe(2);
	releaseRefresh();
	await expect(page.getByRole('status', { name: 'Loading project contents' })).toBeHidden();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(page.getByText('Alpha is ready')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
});

test('restores an exact deep-linked session through direct Session lookup', async ({ page }) => {
	const listRequests: URL[] = [];
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) => {
		const url = new URL(route.request().url());
		listRequests.push(url);
		if (url.searchParams.get('sessionId') !== 'deep-target') {
			return route.fulfill({ status: 500, json: { error: 'Expected direct Session lookup' } });
		}
		return route.fulfill({
			json: {
				sessions: [{ sessionId: 'deep-target', cwd: '/work/hue', title: 'Deep target' }],
				hasMore: false
			}
		});
	});
	await page.route(/\/sessions\/deep-target$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Deep session restored' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);
	await addProject(page);
	await expect(page).toHaveURL(/\?project=(?!none)[^&]+/);
	const project = new URL(page.url()).searchParams.get('project');
	await page.goto(`/?project=${project}&session=deep-target`);
	await expect(page.getByText('Deep session restored')).toBeVisible();
	const directLookup = listRequests.find(
		(request) => request.searchParams.get('sessionId') === 'deep-target'
	);
	expect(directLookup).toBeDefined();
	expect(directLookup?.searchParams.has('offset')).toBe(false);
});

test('searches and manages rename pin archive duplicate export and delete impact', async ({
	page
}) => {
	let metadata: Record<string, unknown> = {};
	let searched = '';
	let confirmedDelete = false;
	const source = {
		sessionId: 'manage',
		cwd: '/work/hue',
		title: 'Manage me',
		pinned: false,
		archived: false,
		folder: 'Delivery'
	};
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) => {
		searched = new URL(route.request().url()).searchParams.get('q') ?? searched;
		return route.fulfill({ json: { sessions: [source], hasMore: false } });
	});
	await page.route(/\/sessions\/manage(?:\?.*)?$/, async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('format')) {
			return route.fulfill({
				headers: {
					'content-type': 'text/markdown',
					'content-disposition': 'attachment; filename="manage.md"'
				},
				body: '# Managed export'
			});
		}
		if (route.request().method() === 'PATCH') {
			metadata = (await route.request().postDataJSON()) as Record<string, unknown>;
			return route.fulfill({ json: { session: { ...source, ...metadata }, icon: null } });
		}
		if (route.request().method() === 'POST') {
			return route.fulfill({
				status: 201,
				json: { session: { sessionId: 'manage-copy', cwd: '/work/hue', title: 'Managed copy' } }
			});
		}
		return route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				runtime: {
					profile: 'default',
					capabilities: {
						loadSession: true,
						promptImage: true,
						sessionList: true,
						sessionFork: true,
						sessionResume: false,
						commands: []
					}
				}
			}
		});
	});
	await page.route(/\/sessions\/manage-copy(?:\?.*)?$/, async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === 'DELETE' && !url.searchParams.has('confirm')) {
			return route.fulfill({
				json: { impact: { messages: 2, events: 5, attachments: 1, activeDeliveries: 0 } }
			});
		}
		if (route.request().method() === 'DELETE') {
			confirmedDelete = true;
			return route.fulfill({ json: { deleted: true } });
		}
		return route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		});
	});

	await addProject(page);
	await page.getByRole('button', { name: 'Search sessions' }).click();
	await page.getByRole('searchbox', { name: 'Search Sessions' }).fill('Manage');
	await page.getByRole('searchbox', { name: 'Search Sessions' }).press('Enter');
	await expect.poll(() => searched).toBe('Manage');
	await sessionButton(page, 'Manage me').click();
	await page.getByRole('button', { name: 'Session settings for Manage me' }).click();
	await page.getByRole('button', { name: 'Change session icon' }).click();
	await expect(page.getByRole('dialog', { name: 'Session icon' })).toBeVisible();
	await page.getByRole('button', { name: 'Close Session icon editor' }).click();
	await page.getByRole('button', { name: 'Session settings for Manage me' }).click();
	await expect(page.getByRole('button', { name: 'Import unavailable' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Import unavailable' })).toHaveAttribute(
		'title',
		'Hermes ACP does not provide a Session import seam'
	);
	await page.getByLabel('Title').fill('Managed');
	await expect(page.getByLabel('Move to section')).toHaveValue('Delivery');
	await expect(page.locator('#session-sections option')).toHaveAttribute('value', 'Delivery');
	await page.getByLabel('Move to section').fill('Reviews');
	await page.getByLabel('Move to section').press('Tab');
	await page.getByRole('button', { name: 'Pin session' }).click();
	await page.getByRole('button', { name: 'Archive session' }).click();
	await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
	await expect
		.poll(() => metadata)
		.toMatchObject({ title: 'Managed', pinned: true, archived: true, folder: 'Reviews' });
	await expect(sessionButton(page, 'Managed')).toBeVisible();
	const openOptions = page.getByRole('dialog', { name: 'Session options' });
	if (await openOptions.isVisible())
		await openOptions.getByRole('button', { name: 'Close session options' }).click();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await primarySessionSurface(page)
			.getByRole('button', { name: 'Session settings for Managed' })
			.click();
		const sectionField = page.getByLabel('Move to section');
		await expect(sectionField).toBeVisible();
		const fieldBox = (await sectionField.boundingBox())!;
		expect(fieldBox.x).toBeGreaterThanOrEqual(0);
		expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(viewport.width);
		await page.getByRole('button', { name: 'Close session options' }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	await page.setViewportSize({ width: 1440, height: 900 });

	await page.getByRole('button', { name: 'Edit Managed' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export Markdown' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('hue-manage.md');
	await page.getByRole('button', { name: 'Duplicate' }).click();
	await expect(sessionButton(page, 'Managed copy')).toBeVisible();

	await page.getByRole('button', { name: 'Edit Managed copy' }).click();
	page.once('dialog', async (dialog) => {
		expect(dialog.message()).toContain('2 messages, 5 events, 1 attachments');
		await dialog.accept();
	});
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect(sessionButton(page, 'Managed copy')).toHaveCount(0);
	expect(confirmedDelete).toBe(true);
});

test('disables image and duplicate controls when Hermes omits optional capabilities', async ({
	page
}) => {
	const session = { sessionId: 'reduced', cwd: '/work/hue', title: 'Reduced Hermes' };
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({ json: { sessions: [session], hasMore: false } })
	);
	await page.route(/\/sessions\/reduced(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [{ id: 'active', status: 'running', text: 'Working', images: [] }],
				events: [],
				cursor: 0,
				activeTurn: {
					messageId: 'active',
					status: 'running',
					thought: '',
					output: 'Working',
					error: null
				},
				runtime: {
					profile: 'default',
					capabilities: {
						loadSession: true,
						promptImage: false,
						sessionList: true,
						sessionFork: false,
						sessionResume: false,
						commands: []
					}
				}
			}
		})
	);

	await addProject(page);
	await sessionButton(page, 'Reduced Hermes').click();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const surface = await openComposerOptions(page);
		const attachmentControl = surface.locator('.composer input[type="file"]');
		await expect(attachmentControl).toBeEnabled();
		await expect(attachmentControl).not.toHaveAttribute('accept', /\.png/);
		await page.getByRole('button', { name: 'Session settings for Reduced Hermes' }).click();
		const duplicate = page.getByRole('button', { name: 'Duplicate' });
		await expect(duplicate).toBeDisabled();
		await expect(duplicate).toHaveAttribute('title', 'Hermes does not support Session duplication');
		await page.getByRole('button', { name: 'Close session options' }).click();
	}
});

test('opens and focuses a new Session while Hermes starts', async ({ page }) => {
	const browserErrors: string[] = [];
	let completeSessionCreation!: () => void;
	const sessionCreation = new Promise<void>((resolve) => (completeSessionCreation = resolve));
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	await page.route('**/api/projects/*/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			await sessionCreation;
			return route.fulfill({
				status: 201,
				json: { session: { sessionId: 'session-new', cwd: '/work/hue' }, commands: [] }
			});
		}
		return route.fulfill({ json: { sessions: [] } });
	});

	await addProject(page);
	await page.getByRole('button', { name: 'Add new session', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
	await expect(page.locator('.session-row')).toHaveCount(0);
	await expect(page.locator('.composer-more')).toBeDisabled();
	await page.getByLabel('Message Hermes').fill('Draft while Hermes starts');
	expect(
		await page.evaluate(() => Object.keys(localStorage).some((key) => key.includes(':pending-')))
	).toBe(false);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(page.getByLabel('Message Hermes')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	completeSessionCreation();
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Draft while Hermes starts');
	expect(browserErrors).toEqual([]);
});

test('keeps a failed Session draft ready to retry without a placeholder row', async ({ page }) => {
	let failSessionCreation!: () => void;
	const sessionCreation = new Promise<void>((resolve) => (failSessionCreation = resolve));
	await page.route('**/api/projects/*/sessions', async (route) => {
		if (route.request().method() !== 'POST') return route.fulfill({ json: { sessions: [] } });
		await sessionCreation;
		return route.fulfill({ status: 503, json: { message: 'Hermes is unavailable' } });
	});

	await addProject(page);
	await page.getByRole('button', { name: 'Add new session', exact: true }).click();
	await page.getByLabel('Message Hermes').fill('Keep this draft');
	failSessionCreation();
	await expect(page.getByRole('alert')).toContainText('Request failed (503)');
	await expect(page.locator('.session-row')).toHaveCount(0);
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Keep this draft');
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('starts a new session without the previous session output', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route('**/api/projects/*/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 201,
				json: { session: { sessionId: 'session-new', cwd: '/work/hue' }, commands: [] }
			});
			return;
		}
		await route.fulfill({
			json: {
				sessions: [
					{ sessionId: 'session-empty-activity', cwd: '/work/hue', title: 'Empty activity' },
					{ sessionId: 'session-old', cwd: '/work/hue', title: 'Old' }
				]
			}
		});
	});
	await page.route(/\/sessions\/session-empty-activity$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: [
					{
						sequence: 1,
						type: 'session.work_mode_changed',
						payload: { priorMode: 'autonomous', workMode: 'live', source: 'user' }
					}
				],
				cursor: 1,
				activeTurn: null
			}
		})
	);
	await page.route(/\/sessions\/session-old$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [{ id: 'old-message', status: 'unknown', text: '', images: [] }],
				events: [
					{
						sequence: 1,
						type: 'agent.chunk',
						payload: { messageId: 'old-message', text: 'Previous session wall of text' }
					}
				],
				cursor: 1,
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
	const emptyActivityLoaded = page.waitForResponse(/\/sessions\/session-empty-activity$/);
	await sessionButton(page, 'Empty activity').click();
	await emptyActivityLoaded;
	await expect(page.locator('.session-view')).toHaveClass(/empty-session/);
	await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
	await sessionButton(page, 'Old').click();
	await expect(page.getByText('Previous session wall of text')).toBeVisible();
	const populatedComposerBox = (await page.locator('.composer').boundingBox())!;
	const populatedSessionViewBox = (await page.locator('.session-view').boundingBox())!;
	expect(
		populatedSessionViewBox.y +
			populatedSessionViewBox.height -
			(populatedComposerBox.y + populatedComposerBox.height)
	).toBeLessThanOrEqual(24);
	await page.getByRole('button', { name: 'Add new session', exact: true }).click();

	await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
	const surface = await openComposerOptions(page);
	await expect(surface.getByRole('button', { name: 'Edit approvals' })).toBeVisible();
	await expect(surface.getByRole('button', { name: 'Edit approvals' })).toBeDisabled();
	await expect(page.getByText('Previous session wall of text')).toBeHidden();
	await expect(page.getByText('Delivery status unknown', { exact: true })).toBeHidden();
	await expect(page.getByRole('region', { name: 'Conversation' })).toHaveCSS('contain', 'none');
	await expect(page.getByRole('region', { name: 'Conversation' })).toHaveCSS('overflow', 'visible');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const welcome = page.getByRole('heading', { name: 'Start this Hermes Session' }).locator('..');
		await expect(welcome).toBeVisible();
		if (viewport.width > 700) {
			await expect
				.poll(async () => {
					const welcomeBox = (await welcome.boundingBox())!;
					const composerBox = (await page.locator('.composer').boundingBox())!;
					const sessionViewBox = (await page.locator('.session-view').boundingBox())!;
					const contentTop = await page
						.getByRole('region', { name: 'Conversation' })
						.evaluate(
							(element) => element.previousElementSibling?.getBoundingClientRect().bottom ?? 0
						);
					return Math.abs(
						(welcomeBox.y + composerBox.y + composerBox.height) / 2 -
							(contentTop + sessionViewBox.y + sessionViewBox.height) / 2
					);
				})
				.toBeLessThanOrEqual(2);
		}
		const welcomeBox = (await welcome.boundingBox())!;
		const composerBox = (await page.locator('.composer').boundingBox())!;
		const sendBox = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
		const sessionViewBox = (await page.locator('.session-view').boundingBox())!;
		const contentTop = await page
			.getByRole('region', { name: 'Conversation' })
			.evaluate((element) => element.previousElementSibling?.getBoundingClientRect().bottom ?? 0);
		const centerDelta =
			(welcomeBox.y + composerBox.y + composerBox.height) / 2 -
			(contentTop + sessionViewBox.y + sessionViewBox.height) / 2;
		if (viewport.width > 700) {
			expect(centerDelta).toBeGreaterThanOrEqual(-2);
			expect(centerDelta).toBeLessThanOrEqual(2);
		} else {
			expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(viewport.height);
		}
		expect(composerBox.x + composerBox.width - (sendBox.x + sendBox.width)).toBeLessThanOrEqual(16);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width === 320) {
			await expectMinimumTouchTargets(page.locator('.composer textarea, .composer button'));
		}
	}
	expect(browserErrors).toEqual([]);
});

test('opens the project prompt library from the composer across required viewports', async ({
	page
}, testInfo) => {
	test.setTimeout(60_000);
	const browserErrors: string[] = [];
	let sentPrompt = '';
	let createdFolder = '';
	let createdFavorite = false;
	let updatedFolder = '';
	let updatedBundle = '';
	let savedSkill = '';
	async function openPromptLibrary() {
		const button = page.getByRole('button', { name: 'Prompt library' });
		if (!(await button.isVisible()))
			await page.getByRole('button', { name: 'More session options' }).click();
		await button.click();
	}
	await page.route('**/prompt-catalog.csv', (route) =>
		route.fulfill({
			contentType: 'text/csv',
			body: 'act,prompt,for_devs,type,contributor\nCode Reviewer,Review code carefully,TRUE,TEXT,f\n'
		})
	);
	const workflowRows = [
		{
			id: 'release',
			name: 'Prepare release',
			prompt: 'Run checks and prepare release notes.',
			folder: 'Delivery',
			profile: 'default',
			bundle: 'release',
			archived: false,
			favorite: false
		}
	];
	const bundleRows = [
		{
			name: 'Release',
			slug: 'release',
			description: 'Release safely',
			skills: ['review', 'protected'],
			instruction: 'Check every release.'
		}
	];
	const bundleSkills = [
		{
			name: 'review',
			description: 'Review code',
			enabled: true,
			provenance: 'custom',
			permissions: { read: true, write: true, delete: true }
		},
		{
			name: 'protected',
			description: 'Protected guidance',
			enabled: true,
			provenance: 'bundled',
			permissions: { read: true, write: false, delete: false }
		}
	];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({
					json: { session: { sessionId: 'prompt-run', cwd: '/work/hue', title: 'Prepare release' } }
				})
			: route.fulfill({
					json: {
						sessions: [{ sessionId: 'prompt-origin', cwd: '/work/hue', title: 'Prompt origin' }]
					}
				})
	);
	await page.route(/\/sessions\/prompt-origin$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.route(/\/sessions\/prompt-run\/messages$/, async (route) => {
		sentPrompt = ((await route.request().postDataJSON()) as { text: string }).text;
		await route.fulfill({ status: 202, json: { status: 'queued' } });
	});
	await page.route(/\/sessions\/prompt-run\/events.*/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route('**/api/projects/*/workflows', async (route) => {
		if (route.request().method() === 'POST') {
			const body = (await route.request().postDataJSON()) as (typeof workflowRows)[number];
			createdFolder = body.folder;
			createdFavorite = body.favorite === true;
			const workflow = { ...body, id: 'catalog-copy', archived: false };
			workflowRows.push(workflow);
			await route.fulfill({ status: 201, json: { workflow } });
			return;
		}
		await route.fulfill({ json: { workflows: workflowRows } });
	});
	await page.route('**/api/projects/*/workflows/catalog-copy', async (route) => {
		const patch = (await route.request().postDataJSON()) as Partial<(typeof workflowRows)[number]>;
		updatedFolder = patch.folder ?? '';
		updatedBundle = patch.bundle ?? '';
		Object.assign(workflowRows[1]!, patch);
		await route.fulfill({ json: { workflow: workflowRows[1] } });
	});
	await page.route('**/api/hermes/bundles', async (route) => {
		if (route.request().method() === 'POST') {
			const body = (await route.request().postDataJSON()) as (typeof bundleRows)[number];
			const bundle = {
				...body,
				slug: body.name.toLowerCase().replaceAll(' ', '-'),
				description: body.description ?? '',
				instruction: body.instruction ?? ''
			};
			bundleRows.push(bundle);
			return route.fulfill({ status: 201, json: { bundle } });
		}
		return route.fulfill({ json: { bundles: bundleRows, skills: bundleSkills } });
	});
	await page.route(/\/api\/hermes\/bundles\/([^/?]+)$/, async (route) => {
		const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
		const index = bundleRows.findIndex((bundle) => bundle.slug === slug);
		if (route.request().method() === 'DELETE') {
			bundleRows.splice(index, 1);
			return route.fulfill({ json: { deleted: true } });
		}
		if (route.request().method() === 'PUT') {
			Object.assign(bundleRows[index]!, await route.request().postDataJSON());
			return route.fulfill({ json: { bundle: bundleRows[index] } });
		}
		return route.fulfill({ json: { bundle: bundleRows[index] } });
	});
	await page.route(/\/api\/hermes\/skills\/([^/?]+)$/, async (route) => {
		const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
		const editable = name === 'review';
		if (route.request().method() === 'PUT') {
			savedSkill = ((await route.request().postDataJSON()) as { content: string }).content;
		}
		return route.fulfill({
			json: {
				name,
				content: savedSkill || `---\nname: ${name}\n---\n\n# ${name}\n`,
				provenance: editable ? 'custom' : 'bundled',
				editable
			}
		});
	});

	await addProject(page);
	await sessionButton(page, 'Prompt origin').click();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await openPromptLibrary();
		const dialog = page.getByRole('dialog', { name: 'Prompt library' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /Prompts/ }).click();
		await dialog.locator('summary').filter({ hasText: 'Delivery' }).click();
		await dialog
			.getByRole('navigation', { name: 'Prompts' })
			.getByRole('button', { name: /Prepare release/ })
			.click();
		await expect(dialog.getByRole('heading', { name: 'Prepare release' })).toBeVisible();
		await expect(
			dialog.getByRole('button', { name: 'Add Prepare release to input' })
		).toBeVisible();
		await expect(dialog.getByText('Run checks and prepare release notes.')).toBeVisible();
		await expect(dialog.getByText('HUE · default · Release')).toBeVisible();
		const more = dialog.getByRole('button', { name: 'More actions for Prepare release' });
		expect((await more.boundingBox())!.width).toBeGreaterThanOrEqual(44);
		await more.click();
		await expect(dialog.getByRole('button', { name: 'Edit Workflow' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Duplicate Workflow' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Archive Workflow' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Delete Workflow' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog.getByRole('button', { name: 'Edit Workflow' })).toBeHidden();
		expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(viewport.width);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(dialog.locator('button, input, textarea'));
		await testInfo.attach(`prompt-library-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await dialog.getByRole('button', { name: 'Close prompt library' }).click();
		await expect(dialog).toBeHidden();
	}
	await page.getByLabel('Message Hermes').fill('Existing draft');
	await openPromptLibrary();
	const dialog = page.getByRole('dialog', { name: 'Prompt library' });
	await dialog.getByRole('button', { name: /Prompts/ }).click();
	page.once('dialog', (prompt) => prompt.accept('Operations'));
	await dialog.getByRole('button', { name: 'Add folder' }).click();
	await expect(dialog.locator('form').getByLabel('Folder')).toHaveValue('Operations');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await dialog.getByRole('button', { name: 'Back to prompts' }).click();
	await dialog.getByRole('button', { name: /Community/ }).click();
	await dialog.locator('summary').filter({ hasText: 'Engineering' }).click();
	await dialog
		.getByRole('navigation', { name: 'Community prompts' })
		.getByRole('button', { name: /Code Reviewer/ })
		.click();
	await dialog.getByRole('button', { name: 'Add to favorites' }).click();
	await expect.poll(() => createdFolder).toBe('Engineering');
	await expect.poll(() => createdFavorite).toBe(true);
	await dialog.getByRole('button', { name: 'Back to prompts' }).click();
	await dialog.getByRole('button', { name: /Prompts/ }).click();
	await dialog.locator('summary').filter({ hasText: 'Favorites' }).click();
	await dialog
		.getByRole('navigation', { name: 'Prompts' })
		.getByRole('button', { name: /Code Reviewer/ })
		.click();
	await dialog.getByRole('button', { name: 'More actions for Code Reviewer' }).click();
	await dialog.getByRole('button', { name: 'Edit Workflow' }).click();
	await dialog.locator('form').getByLabel('Hermes bundle').selectOption('release');
	await dialog.locator('form').getByLabel('Folder').fill('Quality');
	await dialog.getByRole('button', { name: 'Save prompt' }).click();
	await expect.poll(() => updatedFolder).toBe('Quality');
	await expect.poll(() => updatedBundle).toBe('release');
	await dialog.getByRole('button', { name: 'Back to prompts' }).click();
	await dialog.getByRole('button', { name: /Prompts/ }).click();
	await dialog.locator('summary').filter({ hasText: 'Delivery' }).click();
	await dialog
		.getByRole('navigation', { name: 'Prompts' })
		.getByRole('button', { name: /Prepare release/ })
		.click();
	await dialog.getByRole('button', { name: 'Add Prepare release to input' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByLabel('Message Hermes')).toHaveValue(
		'Existing draft\n\nRun checks and prepare release notes.'
	);
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
	await openPromptLibrary();
	await dialog.getByRole('button', { name: /Bundles/ }).click();
	await expect(dialog.getByRole('navigation', { name: 'Hermes bundles' })).toBeVisible();
	await expect(dialog.getByLabel('Search prompts')).toBeHidden();
	await dialog.getByRole('button', { name: /^Release / }).click();
	await expect(dialog.getByText('Release safely')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Open review skill' })).toBeVisible();
	await dialog.getByLabel('Include protected').uncheck();
	await dialog.getByRole('button', { name: 'Save bundle' }).click();
	await expect.poll(() => bundleRows[0]?.skills).toEqual(['review']);
	await dialog.getByLabel('Include protected').check();
	await dialog.getByRole('button', { name: 'Save bundle' }).click();
	await dialog.getByRole('button', { name: 'Open review skill' }).click();
	await expect(dialog.getByLabel('Skill content')).toBeEditable();
	await dialog.getByLabel('Skill content').fill('---\nname: review\n---\n\nUpdated\n');
	await dialog.getByRole('button', { name: 'Save skill' }).click();
	await expect.poll(() => savedSkill).toContain('Updated');
	await dialog.getByRole('button', { name: 'Back to bundle', exact: true }).click();
	await dialog.getByRole('button', { name: 'Open protected skill' }).click();
	await expect(dialog.getByLabel('Skill content')).toBeDisabled();
	await expect(dialog.getByText('Read-only · bundled')).toBeVisible();
	await dialog.getByRole('button', { name: 'Back to bundle', exact: true }).click();
	if (await dialog.getByRole('button', { name: 'Back to bundles' }).isVisible()) {
		await dialog.getByRole('button', { name: 'Back to bundles' }).click();
	}
	await dialog.getByRole('button', { name: 'New bundle' }).click();
	await dialog.getByLabel('Bundle name').fill('Quality');
	await dialog.getByLabel('Include review').check();
	await dialog.getByRole('button', { name: 'Add bundle' }).click();
	await dialog.getByLabel('Bundle description').fill('Quality checks');
	await dialog.getByLabel('Include protected').check();
	await dialog.getByRole('button', { name: 'Save bundle' }).click();
	await expect
		.poll(() => bundleRows.find(({ name }) => name === 'Quality')?.skills)
		.toEqual(['review', 'protected']);
	page.once('dialog', (prompt) => prompt.accept('Quality'));
	await dialog.getByRole('button', { name: 'Delete bundle' }).click();
	await expect.poll(() => bundleRows.some(({ name }) => name === 'Quality')).toBe(false);
	page.once('dialog', (prompt) => prompt.accept('Release'));
	await dialog.getByRole('button', { name: 'Delete bundle' }).click();
	await expect.poll(() => bundleRows).toEqual([]);
	await dialog.getByRole('button', { name: 'Back to bundles' }).click();
	await dialog.getByRole('button', { name: 'New bundle' }).click();
	await page.waitForTimeout(200);
	await expect(dialog.getByLabel('Bundle name')).toBeVisible();
	expect(sentPrompt).toBe('');
	expect(browserErrors).toEqual([]);
});

test('safe-area and 200% text keep mobile chrome and sheets reachable', async ({
	browser
}, testInfo) => {
	test.setTimeout(60_000);
	const context = await browser.newContext({
		baseURL: String(testInfo.project.use.baseURL),
		viewport: { width: 320, height: 568 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	try {
		await page.route('**/api/projects/*/sessions', (route) =>
			route.fulfill({
				json: { sessions: [{ sessionId: 'zoom', cwd: '/work/hue', title: 'Zoom' }] }
			})
		);
		await page.route(/\/sessions\/zoom$/, (route) =>
			route.fulfill({
				json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
			})
		);
		await page.route('**/api/projects/*/workflows', (route) =>
			route.fulfill({ json: { workflows: [] } })
		);
		await addProject(page);
		await sessionButton(page, 'Zoom').click();
		for (const viewport of [
			{ width: 320, height: 568 },
			{ width: 390, height: 844 },
			{ width: 412, height: 915 },
			{ width: 844, height: 390 }
		]) {
			await page.setViewportSize(viewport);
			await page.evaluate(() => {
				document.documentElement.style.fontSize = '200%';
				document.documentElement.style.setProperty('--safe-area-top', '18px');
				document.documentElement.style.setProperty('--safe-area-bottom', '24px');
				document.documentElement.style.setProperty('--safe-area-left', '12px');
				document.documentElement.style.setProperty('--safe-area-right', '12px');
			});
			await page.waitForTimeout(300);
			await expect(page.locator('.mobile-navigation')).toHaveCount(0);
			await expectMinimumTouchTargets(page.locator('.session-header button'));
			await expect(page.getByLabel('Message Hermes')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
				)
			).toBe(true);
			for (const selector of ['.session-header', '.composer']) {
				const locator = page.locator(selector);
				const box = await locator.boundingBox();
				const geometry = await locator.evaluate((element) => {
					const style = getComputedStyle(element);
					return {
						viewportWidth: visualViewport?.width ?? innerWidth,
						viewportHeight: visualViewport?.height ?? innerHeight,
						height: style.height,
						maxHeight: style.maxHeight,
						bottom: style.bottom
					};
				});
				expect(box).not.toBeNull();
				expect(box!.x).toBeGreaterThanOrEqual(0);
				expect(
					box!.x + box!.width,
					`${selector} ${viewport.width}x${viewport.height} ${JSON.stringify(geometry)}`
				).toBeLessThanOrEqual(geometry.viewportWidth);
				expect(box!.y).toBeGreaterThanOrEqual(0);
				expect(box!.y + box!.height, `${selector} ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(
					geometry.viewportHeight
				);
			}
			const surface = await openComposerOptions(page);
			await surface.getByRole('button', { name: 'Prompt library' }).click();
			const promptLibrary = page.getByRole('dialog', { name: 'Prompt library' });
			const promptLibraryBox = await promptLibrary.boundingBox();
			expect(promptLibraryBox).not.toBeNull();
			expect(promptLibraryBox!.y).toBeGreaterThanOrEqual(0);
			expect(promptLibraryBox!.y + promptLibraryBox!.height).toBeLessThanOrEqual(viewport.height);
			await promptLibrary.getByRole('button', { name: 'Close prompt library' }).click();
			await openMobileProjects(page);
			await page.getByRole('button', { name: 'Notifications', exact: true }).click();
			const notifications = page.getByRole('region', { name: 'Notifications' });
			await expect(notifications).toBeVisible();
			await expectMinimumTouchTargets(notifications.getByRole('button'));
			await page.getByRole('button', { name: 'Back to workspace' }).click();
			if (viewport.width <= 700) {
				await page.locator('#project-drawer .project-select').filter({ hasText: 'HUE' }).click();
				await sessionButton(page, 'Zoom').click();
			}
		}
	} finally {
		await context.close();
	}
});

test('starts and revisits a session without a project', async ({ page }) => {
	const browserErrors: string[] = [];
	let creations = 0;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			creations += 1;
			await route.fulfill({
				status: 201,
				json: {
					session: { sessionId: 'topic-1', cwd: '/work/topics', title: 'Untitled session' },
					commands: []
				}
			});
			return;
		}
		await route.fulfill({ json: { sessions: [] } });
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await openMobileProjects(page);
		const expectedCreations = creations + 1;
		await page.getByRole('button', { name: 'New chat' }).click();
		await expect.poll(() => creations).toBe(expectedCreations);
		await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
		await expect(page.locator('.projectless-row .project-select').first()).toContainText('Chats');
		await expect(page.getByLabel('Message Hermes')).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('shows external Hermes cron jobs in the Cron tasks folder', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route('**/api/sessions**', async (route) => {
		const url = new URL(route.request().url());
		await route.fulfill({
			json: {
				sessions: [],
				externalCronJobs:
					url.searchParams.get('scope') === 'scheduled'
						? Array.from({ length: 25 }, (_, index) => ({
								jobId: index === 0 ? 'af28bd12971a' : `job-${index}`,
								name:
									index === 0 ? 'Daily review' : `Long scheduled Hermes maintenance job ${index}`,
								profile: 'default',
								profileName: 'Default',
								schedule: 'Daily at 9:00 AM',
								scheduleKind: 'cron',
								enabled: true,
								state: 'scheduled',
								nextRunAt: '2026-08-30T09:00:00Z',
								lastRunAt: '2026-08-29T09:00:00Z',
								lastStatus: 'completed'
							}))
						: []
			}
		});
	});
	await page.route('**/api/hermes/cron/**', async (route) => {
		if (new URL(route.request().url()).pathname.endsWith('/runs')) {
			await route.fulfill({ json: { runs: [] } });
			return;
		}
		const requestBody = route.request().method() === 'PUT' ? route.request().postDataJSON() : null;
		await route.fulfill({
			json: {
				job: {
					jobId: 'af28bd12971a',
					name: requestBody?.updates?.name ?? 'Daily review',
					profile: 'default',
					profileName: 'Default',
					schedule: requestBody?.updates?.schedule ?? '0 9 * * *',
					scheduleKind: 'cron',
					enabled: requestBody?.enabled ?? true,
					state: requestBody?.enabled === false ? 'paused' : 'scheduled',
					nextRunAt: '2026-08-30T09:00:00Z',
					lastRunAt: '2026-08-29T09:00:00Z',
					lastStatus: 'completed',
					prompt: requestBody?.updates?.prompt ?? 'Review progress',
					deliver: requestBody?.updates?.deliver ?? 'local',
					model: requestBody?.updates?.model ?? '',
					provider: requestBody?.updates?.provider ?? '',
					scriptOnly: false
				}
			}
		});
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/?project=none');
		await openMobileProjects(page);
		await page.locator('#project-drawer .project-select').filter({ hasText: 'Cron tasks' }).click();
		await expect(page).toHaveURL(/project=none.*collection=cron/);
		await expect(page.getByRole('heading', { name: 'Cron tasks' })).toBeVisible();
		const row = page.getByRole('group', { name: 'Hermes cron job Daily review' });
		await expect(row).toBeVisible();
		const rowGeometry = await row.evaluate((element) => {
			const button = element.querySelector('button')!;
			return {
				rowHeight: element.getBoundingClientRect().height,
				buttonHeight: button.getBoundingClientRect().height,
				buttonScrollWidth: button.scrollWidth,
				buttonWidth: button.clientWidth
			};
		});
		expect(rowGeometry.rowHeight).toBeGreaterThanOrEqual(rowGeometry.buttonHeight);
		expect(rowGeometry.buttonScrollWidth).toBeLessThanOrEqual(rowGeometry.buttonWidth);
		await row.getByRole('button').click();
		const editor = page.getByRole('main', { name: 'Cron job editor' });
		await expect(editor).toBeVisible();
		await expect(editor.getByRole('heading', { name: 'Daily review' })).toBeVisible();
		await editor.getByRole('button', { name: 'Settings' }).click();
		await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Daily review');
		await expect(editor.getByLabel('Schedule')).toHaveValue('0 9 * * *');
		await expect(editor.getByLabel('Prompt')).toHaveValue('Review progress');
		await expect(editor.getByRole('button', { name: 'Save changes' })).toBeVisible();
		if (viewport === viewports[0]) {
			await editor.getByLabel('Name', { exact: true }).fill('Updated daily review');
			await editor.getByRole('button', { name: 'Save changes' }).click();
			await expect(editor.getByText('Saved', { exact: true })).toBeVisible();
			await expect(editor.getByRole('heading', { name: 'Updated daily review' })).toBeVisible();
		}
		await editor.getByRole('button', { name: 'Remove job' }).click();
		await expect(editor.getByText('Type af28bd12971a to confirm')).toBeVisible();
		await expect(editor.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Add new session' })).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('retries a lost acknowledgement with the same complete envelope', async ({ page }) => {
	const serverEnvelopes: Array<{ messageId: string; text: string }> = [];
	let sessionLoads = 0;
	await page.route('**/api/projects/*/sessions', async (route) => {
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
	await sessionButton(page, 'Retry').click();
	await page.getByLabel('Message Hermes').fill('Execute this exactly once.');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('Delivery status unknown', { exact: true }).last()).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Execute this exactly once.');
	for (const viewport of mobileViewports) {
		await page.setViewportSize(viewport);
		const composer = page.locator('.composer');
		const retry = page.getByRole('button', { name: 'Retry exact message' });
		await expect(retry).toBeVisible();
		await expectMinimumTouchTargets(retry);
		expect(await composer.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
			await composer.evaluate((element) => element.clientWidth)
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	await page.getByRole('button', { name: 'Retry exact message' }).click();

	expect(serverEnvelopes).toHaveLength(2);
	expect(serverEnvelopes[1]).toEqual(serverEnvelopes[0]);
	await openComposerOptions(page);
	await expect(primarySessionSurface(page).getByText('completed', { exact: true })).toBeVisible();
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
	await sessionButton(page, 'Main').click();
	await expect(page).toHaveURL(/\?project=[^&]+&session=session-1$/);

	await expect(page.getByText('Working…')).toBeVisible();
	await expect(page.getByTitle('Message running')).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('Hermes ACP reconnecting');
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();

	await sessionButton(page, 'Another').click();
	await page.getByLabel('Message Hermes').fill('Unsent local draft');
	await sessionButton(page, 'Main').click();
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();

	for (const viewport of viewports) {
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
	await sessionButton(page, 'Another').click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Unsent local draft');
});

test('per-session work mode selector persists across natural text, slash alias, selector toggle, and reload', async ({
	page
}) => {
	let workMode: 'autonomous' | 'live' = 'autonomous';
	let sequence = 1;
	const workModeEvents: Array<{
		sequence: number;
		type: string;
		createdAt: string;
		payload: Record<string, unknown>;
	}> = [];
	const patchBodies: Array<Record<string, unknown>> = [];
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		await route.fulfill({
			json: {
				sessions: [{ sessionId: 'session-1', cwd: '/work/hue', title: 'Main', workMode }]
			}
		});
	});
	await page.route(/\/api\/projects\/[^/]+\/sessions\/session-1$/, async (route) => {
		if (route.request().method() === 'PATCH') {
			const body = (await route.request().postDataJSON()) as Record<string, unknown>;
			patchBodies.push(body);
			const priorMode = workMode;
			workMode = body.workMode as 'autonomous' | 'live';
			const event = {
				sequence: sequence++,
				type: 'session.work_mode_changed',
				createdAt: new Date(Date.UTC(2026, 7, 23, 10, sequence)).toISOString(),
				payload: { priorMode, workMode, source: 'user' }
			};
			workModeEvents.push(event);
			return route.fulfill({
				json: { session: { sessionId: 'session-1', workMode }, workMode, event }
			});
		}
		await route.fulfill({
			json: {
				transcript: [],
				messages: [],
				events: workModeEvents,
				cursor: workModeEvents.at(-1)?.sequence ?? 0,
				activeTurn: null,
				workMode
			}
		});
	});
	await page.route(/\/api\/projects\/[^/]+\/sessions\/session-1\/messages$/, async (route) => {
		const body = (await route.request().postDataJSON()) as { messageId: string; text: string };
		if (body.text === '/autonomous-delivery') {
			workMode = 'autonomous';
			return route.fulfill({
				status: 202,
				json: {
					messageId: body.messageId,
					duplicate: false,
					status: 'completed',
					workMode,
					consumed: true
				}
			});
		}
		if (body.text === "I'm at the computer") workMode = 'live';
		await route.fulfill({
			status: 202,
			json: { messageId: body.messageId, duplicate: false, status: 'queued', workMode }
		});
	});
	await page.route(/\/api\/projects\/[^/]+\/sessions\/session-1\/events\?after=.*/, async (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route('**/api/projects/*/workflows', (route) =>
		route.fulfill({ json: { workflows: [] } })
	);
	await page.route('**/api/hermes/bundles', (route) =>
		route.fulfill({
			json: {
				bundles: [
					{
						name: 'autonomous',
						slug: 'autonomous',
						description: 'Work independently.',
						skills: ['autonomous-delivery'],
						instruction: ''
					},
					{
						name: 'live',
						slug: 'live',
						description: 'Collaborate turn by turn.',
						skills: ['live-co-development'],
						instruction: ''
					}
				],
				skills: []
			}
		})
	);

	await addProject(page);
	await sessionButton(page, 'Main').click();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const selector = page.getByLabel('Work mode', { exact: true });
		await expect(selector).toBeVisible();
		const selectorBox = (await selector.boundingBox())!;
		expect(selectorBox.width).toBeGreaterThanOrEqual(96);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			expect((await selector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		await selector.click();
		const menu = page.getByRole('dialog', { name: 'Choose work mode' });
		await expect(
			menu.getByRole('button', { name: 'Review and edit Autonomous bundle' })
		).toBeVisible();
		await expect(menu.getByRole('button', { name: 'Review and edit Live bundle' })).toBeVisible();
		if (viewport.width <= 390) await expectMinimumTouchTargets(menu.locator('button'));
		await page.keyboard.press('Escape');
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByLabel('Message Hermes').fill("I'm at the computer");
	await page.getByLabel('Message Hermes').press('Enter');
	const workModeButton = page.getByRole('button', { name: 'Work mode' });
	await expect(workModeButton).toHaveAttribute('title', 'Work mode: Live');

	await page.getByLabel('Message Hermes').fill('/autonomous-delivery');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect(workModeButton).toHaveAttribute('title', 'Work mode: Autonomous');
	await expect(page.getByText('/autonomous-delivery')).toHaveCount(0);

	await workModeButton.click();
	await page.getByRole('button', { name: 'Review and edit Autonomous bundle' }).click();
	const promptLibrary = page.getByRole('dialog', { name: 'Prompt library' });
	await expect(promptLibrary.getByRole('heading', { name: 'autonomous' })).toBeVisible();
	await promptLibrary.getByRole('button', { name: 'Close prompt library' }).click();
	await workModeButton.click();
	await page
		.getByRole('dialog', { name: 'Choose work mode' })
		.getByRole('button', { name: /^Live/ })
		.click();
	await expect(workModeButton).toHaveAttribute('title', 'Work mode: Live');
	await page.getByRole('button', { name: 'Thinking' }).click();
	await expect(page.getByText('Work mode changed to Live')).toBeVisible();

	await page.reload();
	await expect(page.getByRole('button', { name: 'Work mode' })).toHaveAttribute(
		'title',
		'Work mode: Live'
	);
	expect(patchBodies).toEqual([{ workMode: 'live' }]);
});

test('mobile uses a full-screen Projects to Sessions hierarchy without global top navigation', async ({
	page
}) => {
	await page.route('**/api/projects/*/sessions', async (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	expect(await page.locator('#project-drawer').count()).toBe(1);
	for (const width of [390, 360, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await page.goto('/');
		await expect(page.locator('.mobile-navigation')).toHaveCount(0);
		const projects = page.locator('#project-drawer');
		await expect(projects).toBeVisible();
		expect((await projects.boundingBox())?.width).toBeCloseTo(width, 3);
		await expectMinimumTouchTargets(
			projects.locator(
				':scope > .section-heading button, :scope > nav > button, :scope > nav > div > button'
			)
		);
		await projects.locator('.project-select').filter({ hasText: 'HUE' }).click();
		const sessions = page.locator('#session-drawer');
		await expect(projects).toBeHidden();
		await expect(sessions).toBeVisible();
		expect((await sessions.boundingBox())?.width).toBeCloseTo(width, 3);
		expect(await sessions.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
		expect(await sessions.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe(
			'1px'
		);
		expect(
			await page
				.locator('.session-workspace')
				.evaluate((element) => getComputedStyle(element).boxShadow)
		).toBe('none');
		expect(
			await page
				.locator('.session-workspace')
				.evaluate((element) => getComputedStyle(element).borderLeftWidth)
		).toBe('1px');
		await expect(page.getByRole('button', { name: 'Back to Projects' })).toBeVisible();
		await expectMinimumTouchTargets(sessions.locator('button'));
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width
		);
	}
});

test('mobile Project taps do not restore the previous desktop pane Session', async ({ page }) => {
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'desktop-primary', cwd: '/work/hue', title: 'Desktop primary' }]
			}
		})
	);
	await page.route(/\/sessions\/desktop-primary$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	await sessionButton(page, 'Desktop primary').click();
	const projectId = new URL(page.url()).searchParams.get('project')!;
	await expect
		.poll(() =>
			page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.primary?.sessionId,
				`hue:session-panes:${projectId}`
			)
		)
		.toBe('desktop-primary');

	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Back to Sessions' }).click();
	await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');
	await page.getByRole('button', { name: 'Back to Projects' }).click();
	const projects = page.locator('#project-drawer');
	await expect(projects).toHaveAttribute('aria-hidden', 'false');
	const project = projects.locator('.project-select').filter({ hasText: 'HUE' });
	const box = (await project.boundingBox())!;
	const tap = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await browserTouchDrag(page, tap, tap);
	await page.waitForTimeout(400);

	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('.workspace')).toHaveClass(/mobile-sessions/);
	await expect(page.getByRole('heading', { name: 'Desktop primary' })).toBeHidden();
});

test('mobile Session rows reveal edit archive and delete actions when swiped left', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on(
		'console',
		(message) =>
			message.type() === 'error' &&
			browserErrors.push(`${message.text()} ${message.location().url}`.trim())
	);
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'swipe-target', cwd: '/work/hue', title: 'Swipe target' }]
			}
		})
	);
	await page.route(/\/api\/projects\/[^/]+\/sessions\/swipe-target$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 }
	]) {
		await page.setViewportSize(viewport);
		await addProject(page);
		const row = page.locator('.session-row').filter({ hasText: 'Swipe target' });
		await row.hover();
		await expect(row.locator('.session-desktop-action').first()).toBeVisible();
		await expect(row.locator('.session-swipe-actions')).toBeHidden();
	}
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 568 }
	]) {
		await page.setViewportSize(viewport);
		await addProject(page);
		const row = page.locator('.session-row').filter({ hasText: 'Swipe target' });
		await expect(row).toBeVisible();
		await page.waitForTimeout(300);
		const box = (await row.boundingBox())!;
		await touchDrag(
			page,
			{ x: box.x + box.width - 24, y: box.y + box.height / 2 },
			{ x: box.x + box.width - 180, y: box.y + box.height / 2 }
		);

		const actions = row.locator('.session-swipe-actions');
		await expect(actions.getByRole('button', { name: 'Edit Swipe target' })).toBeVisible();
		await expect(actions.getByRole('button', { name: 'Archive Swipe target' })).toBeVisible();
		await expect(actions.getByRole('button', { name: 'Delete Swipe target' })).toBeVisible();
		await expectMinimumTouchTargets(actions.getByRole('button'));
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
	expect(browserErrors).toEqual([]);
});

test('short mobile chat contains hostile content and keeps core controls reachable', async ({
	page,
	context
}, testInfo) => {
	test.setTimeout(60_000);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const token = 'unbroken'.repeat(70);
	const longPath = `/workspace/${'nested-directory/'.repeat(35)}file.ts`;
	const longUrl = `https://example.test/${'long-segment/'.repeat(35)}resource?id=${token}`;
	const errors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => errors.push(`${request.method()} ${request.url()}`));
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({
			json: { sessions: [{ sessionId: 'mobile-hostile', cwd: longPath, title: 'Mobile contract' }] }
		})
	);
	await page.route(/\/sessions\/mobile-hostile$/, (route) =>
		route.fulfill({
			json: {
				transcript: [
					{
						role: 'assistant',
						text: `${longUrl}\n\n${longPath}\n\n${token}\n\nThen consider:\n\n- Who was the person?\n- What were they trying to do?\n\n| Model | ID |\n| --- | --- |\n| Hermes | ${token} |\n\nAfter the table.\n\n| Name | Value |\n| --- | --- |\n| Local | Ready |\n\n\`\`\`ts\nconst answer: number = 42;\n\`\`\`\n\n\`\`\`mermaid\ngraph TD\nA[Start] --> B[Ready]\n\`\`\`\n\n\`\`\`text\n${token}\n\`\`\``,
						images: [
							{
								name: 'Pixel',
								mimeType: 'image/png',
								data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WvAAAAAElFTkSuQmCC'
							}
						]
					}
				],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null,
				branch: 'feat/mobile',
				runtime: {
					profile: 'default',
					models: {
						currentModelId: 'openai:gpt-5.6',
						availableModels: [
							{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' },
							{ modelId: `anthropic:${token}`, name: 'Claude Mobile' }
						]
					}
				}
			}
		})
	);

	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	await sessionButton(page, 'Mobile contract').click();
	await page.setViewportSize({ width: 320, height: 568 });
	const article = page.locator('.transcript article.assistant');
	await expect(article).toBeVisible();
	expect(
		await article.locator('.message').evaluate((element) => ({
			background: getComputedStyle(element).backgroundColor,
			border: getComputedStyle(element).borderTopWidth,
			padding: getComputedStyle(element).paddingInlineStart
		}))
	).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', padding: '0px' });
	expect(await article.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
		true
	);
	expect(
		await article
			.locator('.message')
			.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
		)
	).toBe(true);
	const code = page.locator('.markdown pre');
	expect(await code.last().evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
		true
	);
	const keyword = page.locator('.markdown code.language-typescript .token.keyword');
	await expect(keyword).toHaveText('const');
	expect(
		await keyword.evaluate(
			(element) =>
				getComputedStyle(element).color !== getComputedStyle(element.parentElement!).color
		)
	).toBe(true);
	await expect(page.getByRole('img', { name: 'Mermaid diagram' })).toBeVisible();
	await expect(page.locator('.table-toolbar button svg')).toHaveCount(4);
	await expect(page.locator('.code-toolbar button svg')).toHaveCount(7);
	const typescriptBlock = page.locator('.code-block:has(code.language-typescript)');
	await typescriptBlock.getByRole('button', { name: 'Wrap code' }).click();
	expect(
		await typescriptBlock
			.locator('code')
			.evaluate((element) => getComputedStyle(element).whiteSpace)
	).toBe('pre-wrap');
	const mermaidBlock = page.locator('.code-block:has(.mermaid-diagram)');
	await mermaidBlock.getByRole('button', { name: 'Show Mermaid source' }).click();
	await expect(mermaidBlock.locator('pre')).toBeVisible();
	const diagramDownload = page.waitForEvent('download');
	await mermaidBlock.getByRole('button', { name: 'Download Mermaid diagram' }).click();
	expect((await diagramDownload).suggestedFilename()).toBe('mermaid-diagram.svg');
	const listItem = page.locator('.markdown li').first();
	expect(await listItem.evaluate((element) => getComputedStyle(element).listStyleType)).toBe(
		'disc'
	);
	expect(
		await listItem.evaluate((element) => parseFloat(getComputedStyle(element).marginBlockEnd))
	).toBeGreaterThanOrEqual(4);
	const tables = page.locator('.markdown table');
	const table = tables.first();
	expect(
		await table
			.locator('td')
			.first()
			.evaluate((element) => parseFloat(getComputedStyle(element).paddingInlineStart))
	).toBeGreaterThanOrEqual(8);
	expect(
		await table
			.locator('xpath=../..')
			.evaluate((element) => parseFloat(getComputedStyle(element).marginBlockStart))
	).toBeGreaterThanOrEqual(12);
	const tableBlocks = page.locator('.markdown .table-block');
	await expect(tableBlocks).toHaveCount(2);
	const firstTable = tableBlocks.first();
	const secondTable = tableBlocks.nth(1);
	const wrap = firstTable.getByRole('button', { name: 'Wrap table cells' });
	await expect(wrap).toHaveAttribute('aria-pressed', 'true');
	expect(
		await firstTable
			.locator('td')
			.first()
			.evaluate((cell) => getComputedStyle(cell).whiteSpace)
	).toBe('normal');
	await wrap.click();
	await expect(wrap).toHaveAttribute('aria-pressed', 'false');
	expect(
		await firstTable
			.locator('.table-scroll')
			.evaluate((element) => element.scrollWidth > element.clientWidth)
	).toBe(true);
	await expect(secondTable.getByRole('button', { name: 'Wrap table cells' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await firstTable.getByRole('button', { name: 'Copy table' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		`Model\tID\nHermes\t${token}`
	);
	await expect(page.getByText('Table copied')).toBeVisible();
	await expectMinimumTouchTargets(firstTable.locator('.table-toolbar button'));
	await expect(page.getByRole('img', { name: 'Pixel' })).toBeVisible();
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(tableBlocks).toHaveCount(2);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(firstTable.locator('.table-toolbar button'));
		const codeToolbarBox = (await typescriptBlock.locator('.code-toolbar').boundingBox())!;
		const codeSurfaceBox = (await typescriptBlock.locator('pre').boundingBox())!;
		expect(codeToolbarBox.y + codeToolbarBox.height).toBeLessThanOrEqual(codeSurfaceBox.y);
		const tableToolbarBox = (await firstTable.locator('.table-toolbar').boundingBox())!;
		const tableSurfaceBox = (await firstTable.locator('.table-scroll').boundingBox())!;
		expect(tableToolbarBox.y + tableToolbarBox.height).toBeLessThanOrEqual(tableSurfaceBox.y);
		const controlBox = (await typescriptBlock
			.getByRole('button', { name: 'Copy code' })
			.boundingBox())!;
		if (viewport.width <= 390) expect(controlBox.height).toBeGreaterThanOrEqual(44);
		else expect(controlBox.height).toBeLessThanOrEqual(32);
		if (viewport.width > 390) {
			const shortTableBox = (await secondTable.boundingBox())!;
			const messageBox = (await article.locator('.message').boundingBox())!;
			expect(shortTableBox.width).toBeLessThan(messageBox.width * 0.75);
		}
		await testInfo.attach(`chat-tables-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}

	const textarea = page.getByLabel('Message Hermes');
	expect((await textarea.boundingBox())!.height).toBe(44);
	await textarea.fill(
		Array.from({ length: 18 }, (_, index) => `Unsent draft line ${index}`).join('\n')
	);
	const grown = (await textarea.boundingBox())!;
	expect(grown.height).toBeGreaterThan(44);
	expect(grown.height).toBeLessThanOrEqual(160);
	expect(await textarea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
		true
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(textarea).toHaveValue(/Unsent draft line 17/);

	await page.getByRole('button', { name: 'Hermes model' }).click();
	const picker = page.getByRole('dialog', { name: 'Choose Hermes model' });
	await expect(picker).toBeVisible();
	await picker.getByLabel('Search models').fill('Claude');
	const model = picker.getByRole('button', { name: /Claude Mobile/ });
	await expect(model).toBeVisible();
	expect((await model.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await picker.getByRole('button', { name: 'Close model picker' }).click();

	await page.locator('.session-header button[title="Session settings"]').click();
	const dialog = page.getByRole('dialog', { name: 'Session options' });
	await expect(dialog.getByText('Saved automatically')).toBeVisible();
	const remove = dialog.getByRole('button', { name: 'Remove' });
	await remove.scrollIntoViewIfNeeded();
	const removeBox = (await remove.boundingBox())!;
	expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(844);
	const close = dialog.getByRole('button', { name: 'Close session options' });
	const closeBox = (await close.boundingBox())!;
	expect(closeBox.y).toBeGreaterThanOrEqual(0);
	expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(844);
	await close.click();

	await openMobileProjects(page);
	await page.getByRole('button', { name: 'App settings', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'App settings dialog' })).toBeVisible();
	await expect(page.getByLabel('Theme')).toBeVisible();
	await expectMinimumTouchTargets(page.locator('.composer button'));
	expect(errors).toEqual([]);
});

test('touch landscape keeps compact navigation and one active Project tool', async ({
	browser
}, testInfo) => {
	const context = await browser.newContext({
		baseURL: String(testInfo.project.use.baseURL),
		viewport: { width: 844, height: 390 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	try {
		await mockTerminalRequests(page);
		await mockDefaultSessionRequests(page);
		await page.route('**/api/projects/*/repository', (route) =>
			route.fulfill({
				json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
			})
		);
		await addProject(page);
		const projects = (await (await page.request.get('/api/projects')).json()) as {
			projects: Array<{ id: string; name: string }>;
		};
		await page.goto(`/?project=${projects.projects.find(({ name }) => name === 'HUE')!.id}`);
		await expect(page.locator('.mobile-navigation')).toHaveCount(0);
		await page.getByRole('button', { name: 'Open Project tools' }).click();
		const workbench = page.getByRole('region', { name: /workbench/ });
		await expect(workbench).toBeVisible();
		await expect(workbench.locator('.workbench-panel:visible')).toHaveCount(1);
		await expectMinimumTouchTargets(workbench.locator('button, a'));
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			)
		).toBe(true);
	} finally {
		await context.close();
	}
});

test('mobile swipe-back moves chat to Sessions to Projects from anywhere in the content', async ({
	page
}) => {
	await page.route(/\/api\/(?:projects\/[^/]+\/)?sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'gesture-session', cwd: '/work/hue', title: 'Gesture session' }]
			}
		})
	);
	await page.route(/\/sessions\/gesture-session$/, (route) =>
		route.fulfill({
			json: {
				transcript: [{ role: 'assistant', text: 'Swipe anywhere on this message.' }],
				messages: [],
				events: [],
				cursor: 0,
				activeTurn: null
			}
		})
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await addProject(page);
	await sessionButton(page, 'Gesture session').click();
	await page.setViewportSize({ width: 390, height: 844 });
	const composer = await page.getByLabel('Message Hermes').boundingBox();
	await touchDrag(
		page,
		{ x: composer!.x + composer!.width / 2, y: composer!.y + composer!.height / 2 },
		{ x: composer!.x + composer!.width - 4, y: composer!.y + composer!.height / 2 }
	);
	await expect(page.locator('#session-drawer')).toBeHidden();

	await touchDrag(page, { x: 180, y: 300 }, { x: 220, y: 302 });
	await expect(page.locator('#session-drawer')).toBeHidden();
	await browserTouchDrag(page, { x: 180, y: 300 }, { x: 320, y: 302 }, async () => {
		await expect(page.locator('#session-drawer')).toBeVisible();
		expect((await page.locator('.session-workspace').boundingBox())!.x).toBeGreaterThan(0);
	});
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');

	await touchDrag(page, { x: 120, y: 300 }, { x: 300, y: 302 }, async () => {
		await expect(page.locator('#project-drawer')).toBeVisible();
		expect((await page.locator('#session-drawer').boundingBox())!.x).toBeGreaterThan(0);
	});
	await expect(page.locator('#project-drawer')).toBeVisible();
	await expect(page.locator('#project-drawer')).toHaveAttribute('aria-hidden', 'false');
	await expect(page.locator('#session-drawer')).toBeHidden();
	await expect(page.locator('.mobile-navigation')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('reduced motion suppresses synthesized click after touch gesture', async ({ page }) => {
	await page.route(/\/api\/(?:projects\/[^/]+\/)?sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [{ sessionId: 'gesture-session', cwd: '/work/hue', title: 'Gesture session' }]
			}
		})
	);
	await page.route(/\/sessions\/gesture-session$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await addProject(page);
	await sessionButton(page, 'Gesture session').click();

	const click = await page.evaluate(() => {
		const target = document.elementFromPoint(32, 300)!;
		let bubbled = 0;
		document.body.addEventListener('click', () => bubbled++, { once: true });
		const pointer = (type: string, x: number) =>
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 42,
				pointerType: 'touch',
				isPrimary: true,
				clientX: x,
				clientY: 300
			});
		target.dispatchEvent(pointer('pointerdown', 32));
		window.dispatchEvent(pointer('pointermove', 48));
		window.dispatchEvent(pointer('pointermove', 180));
		window.dispatchEvent(pointer('pointerup', 180));
		const synthesized = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: 180,
			clientY: 300
		});
		const allowed = target.dispatchEvent(synthesized);
		return { allowed, bubbled, defaultPrevented: synthesized.defaultPrevented };
	});

	expect(click).toEqual({ allowed: false, bubbled: 0, defaultPrevented: true });
});

test('browser Back keeps dirty Project state unchanged until discard confirmation', async ({
	page
}) => {
	await removeProjects(page);
	const dirtyRoot = mkdtempSync(join(tmpdir(), 'hue-dirty-back-project-'));
	await page.route('**/api/projects/*/files**', (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('mode') === 'preview')
			return route.fulfill({
				json: {
					path: 'README.md',
					name: 'README.md',
					type: 'file',
					kind: 'markdown',
					mime: 'text/markdown',
					size: 5,
					mtime: new Date(0).toISOString(),
					version: { hash: 'dirty', mtimeNs: '1', size: 5 },
					content: '# HUE'
				}
			});
		return route.fulfill({
			json: {
				entries: [
					{
						name: 'README.md',
						path: 'README.md',
						type: 'file',
						size: 5,
						mtime: new Date(0).toISOString()
					}
				],
				truncated: false
			}
		});
	});
	const created = await page.request.post('/api/projects', {
		data: {
			name: 'Dirty Back Project',
			folders: [dirtyRoot],
			primaryPath: dirtyRoot
		}
	});
	const project = ((await created.json()) as { project: { id: string } }).project;
	try {
		await page.goto('/?project=none');
		await page
			.locator('.project-rail nav .project-select')
			.filter({ hasText: 'Dirty Back Project' })
			.click();
		await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
		await page.getByRole('button', { name: 'Files', exact: true }).click();
		await page.getByRole('treeitem', { name: /README\.md/ }).click();
		await page.getByRole('button', { name: 'Edit Markdown source' }).click();
		await page.getByLabel('File content').fill('# Unsaved Back regression');
		await expect(page.getByRole('button', { name: 'Save file' })).toBeEnabled();

		await page.goBack();

		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await expect(page.getByLabel('File content')).toHaveValue('# Unsaved Back regression');
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(page.getByLabel('File content')).toHaveValue('# Unsaved Back regression');
	} finally {
		await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		rmSync(dirtyRoot, { recursive: true, force: true });
	}
});

test('durable mobile destination restores safely and browser Back follows drawer hierarchy', async ({
	page
}) => {
	await page.route(/\/api\/(?:projects\/[^/]+\/)?sessions(?:\?.*)?$/, async (route) => {
		const projectless = !route.request().url().includes('/projects/');
		await route.fulfill({
			json: {
				sessions: projectless
					? [{ sessionId: 'general', cwd: '/work/general', title: 'General session' }]
					: [{ sessionId: 'remembered', cwd: '/work/hue', title: 'Remembered session' }]
			}
		});
	});
	await page.route(/\/sessions\/(remembered|general)$/, (route) =>
		route.fulfill({
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
		})
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await addProject(page);
	const projects = (await (await page.request.get('/api/projects')).json()) as {
		projects: Array<{ id: string; name: string }>;
	};
	const projectId = projects.projects.find(({ name }) => name === 'HUE')!.id;
	await sessionButton(page, 'Remembered session').click();
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();

	await page.goto('/');
	await expect(page).toHaveURL(new RegExp(`project=${projectId}.*session=remembered`));
	if (await page.locator('#project-drawer').isVisible()) {
		await page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }).click();
		await sessionButton(page, 'Remembered session').click();
	}
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();

	await page.getByRole('button', { name: 'Back to Sessions' }).click();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Back to Projects' })).toBeFocused();
	await page.getByRole('button', { name: 'Back to Projects' }).click();
	await page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }).click();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await sessionButton(page, 'Remembered session').click();
	await expect(page.locator('#session-drawer')).toBeHidden();

	await page.getByRole('button', { name: 'Back to Sessions' }).click();
	await expect(page).toHaveURL(/pane=sessions/);
	await page.getByRole('button', { name: 'Back to Projects' }).click();
	await expect(page).toHaveURL(/pane=projects/);
	await page.goBack();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.locator('#project-drawer')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Back to Projects' })).toBeFocused();
	await page.goBack();
	await expect(page.locator('#session-drawer')).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Back to Sessions' })).toBeFocused();

	await page.evaluate((id) => {
		localStorage.setItem(
			'hue:navigation:v1',
			JSON.stringify({ version: 1, projectId: id, sessionId: 'remembered', pane: 'sessions' })
		);
	}, projectId);
	await page.goto('/');
	await expect(page.locator('#project-drawer')).toBeVisible();
	await page.locator('#project-drawer .project-select').filter({ hasText: 'HUE' }).click();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await page.reload();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.waitForTimeout(100);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator('#session-drawer')).toBeVisible();

	await page.goto('/?project=none&session=general');
	await expect(page.getByRole('heading', { name: 'General session' })).toBeVisible();
	await expect(page).toHaveURL(/project=none&session=general/);

	await page.evaluate((id) => {
		localStorage.setItem(
			'hue:navigation:v1',
			JSON.stringify({ version: 1, projectId: id, sessionId: 'deleted-session', pane: null })
		);
	}, projectId);
	await page.goto('/');
	await expect(page).not.toHaveURL(/deleted-session/);
	await expect
		.poll(
			async () =>
				(await page.locator('#session-drawer').isVisible()) ||
				(await page.getByRole('heading', { name: 'General session' }).isVisible())
		)
		.toBe(true);

	await page.evaluate(() => {
		localStorage.setItem(
			'hue:navigation:v1',
			JSON.stringify({
				version: 1,
				projectId: 'deleted-project',
				sessionId: 'deleted-session',
				pane: 'sessions'
			})
		);
	});
	await page.goto('/');
	await expect(page.locator('#project-drawer')).toBeVisible();
	await expect(page.locator('#session-drawer')).toBeHidden();
	await expect(page).not.toHaveURL(/deleted-project|deleted-session/);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('keeps startup interactive and terminal unloaded until explicit activation', async ({
	page
}) => {
	const root = mkdtempSync(join(tmpdir(), 'hue-startup-terminal-'));
	let projectId = '';
	let releaseSessions!: () => void;
	const sessionsGate = new Promise<void>((resolve) => (releaseSessions = resolve));
	let terminalCreates = 0;
	let terminalPolls = 0;
	let sessionRequests = 0;
	let repositoryRequests = 0;
	let healthRequests = 0;
	const scripts: string[] = [];
	page.on('request', (request) => {
		if (request.resourceType() === 'script') scripts.push(request.url());
	});
	try {
		const response = await page.request.post('/api/projects', {
			data: { name: 'Startup', folders: [root], primaryPath: root }
		});
		const project = (await response.json()).project as { id: string };
		projectId = project.id;
		await controlIdleCallbacks(page);
		await page.route(`/api/projects/${project.id}/sessions`, async (route) => {
			sessionRequests += 1;
			await sessionsGate;
			await route.fulfill({ json: { sessions: [] } });
		});
		await page.route(`/api/projects/${project.id}/repository`, (route) => {
			repositoryRequests += 1;
			return route.fulfill({
				json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
			});
		});
		await page.route(`**/api/health?projectId=${project.id}`, (route) => {
			healthRequests += 1;
			return route.fulfill({ json: { checks: [] } });
		});
		await page.route(`/api/projects/${project.id}/terminal**`, async (route) => {
			if (route.request().method() === 'GET') {
				terminalPolls += 1;
				return route.fulfill({
					json: {
						output: '',
						cursor: 0,
						inputSequence: 0,
						reset: false,
						status: 'running'
					}
				});
			}
			const body = (await route.request().postDataJSON()) as { action: string };
			if (body.action === 'create') terminalCreates += 1;
			return route.fulfill({
				json:
					body.action === 'create'
						? { terminalId: 'startup-terminal', cursor: 0, status: 'running' }
						: { success: true }
			});
		});

		await page.goto(`/?project=${project.id}`);
		const projectTools = page.getByRole('navigation', { name: 'Project tools' });
		await expect(projectTools).toBeVisible();
		const terminalEntry = JSON.parse(
			readFileSync('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
		) as Record<string, { file: string }>;
		const terminalAsset = terminalEntry['src/lib/components/workbench/TerminalPanel.svelte']?.file;
		expect(terminalAsset).toBeTruthy();
		expect(sessionRequests).toBeLessThanOrEqual(1);
		expect(scripts.some((url) => url.endsWith(terminalAsset))).toBe(false);
		expect(terminalCreates).toBe(0);
		expect(terminalPolls).toBe(0);
		expect(repositoryRequests).toBe(0);
		expect(healthRequests).toBe(0);

		await projectTools.getByRole('button', { name: 'Terminal', exact: true }).click();
		await expect(page.getByRole('article', { name: 'Project terminal' })).toBeVisible();
		await expect.poll(() => scripts.some((url) => url.endsWith(terminalAsset))).toBe(true);
		await expect.poll(() => terminalCreates).toBe(1);
		await expect.poll(() => terminalPolls).toBeGreaterThan(0);
		await page.waitForTimeout(250);
		expect(terminalCreates).toBe(1);
	} finally {
		releaseSessions();
		if (projectId) await page.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test('defers Git and keeps health usable when Git fails', async ({ page }) => {
	const root = mkdtempSync(join(tmpdir(), 'hue-startup-git-failure-'));
	let projectId = '';
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
	try {
		const response = await page.request.post('/api/projects', {
			data: { name: 'Git failure', folders: [root], primaryPath: root }
		});
		const project = (await response.json()).project as { id: string };
		projectId = project.id;
		let repositoryRequests = 0;
		let healthRequests = 0;
		await controlIdleCallbacks(page);
		await page.route(`/api/projects/${project.id}/sessions`, (route) =>
			route.fulfill({ json: { sessions: [] } })
		);
		await page.route(`/api/projects/${project.id}/repository`, (route) => {
			repositoryRequests += 1;
			return route.fulfill({ status: 503, json: { error: 'Git unavailable' } });
		});
		await page.route(`**/api/health?projectId=${project.id}`, (route) => {
			healthRequests += 1;
			return route.fulfill({
				json: {
					checks: [
						{ id: 'project', label: 'Project', status: 'ready', summary: 'Healthy', action: 'Open' }
					]
				}
			});
		});

		await page.goto(`/?project=${project.id}`);
		const workbench = page.getByRole('region', { name: 'Git failure workbench' });
		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			if (viewport.width <= 700) {
				await expect(page.getByRole('button', { name: 'Open Project tools' })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
					viewport.width
				);
				continue;
			}
			await expect(
				page
					.getByRole('navigation', { name: 'Project tools' })
					.getByRole('button', { name: /^Git/ })
			).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			if (viewport.width <= 390) await expectMinimumTouchTargets(workbench.locator('button, a'));
		}
		expect(repositoryRequests).toBe(0);
		expect(healthRequests).toBe(0);
		await page.setViewportSize(viewports[0]);
		await page.waitForTimeout(50);
		await runIdleCallbacks(page);
		await page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: /^Git/ })
			.click();
		await expect(workbench.getByRole('article', { name: 'Git status' })).toContainText(
			'Git unavailable'
		);
		await expect(page.getByRole('region', { name: 'Runtime health' })).toContainText('Healthy');
		expect(repositoryRequests).toBe(2);
		expect(healthRequests).toBe(1);
		expect(browserErrors).toEqual([
			'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
			'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
		]);
	} finally {
		if (projectId) await page.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test('defers health and keeps Git usable when health fails', async ({ page }) => {
	const root = mkdtempSync(join(tmpdir(), 'hue-startup-health-failure-'));
	let projectId = '';
	try {
		const response = await page.request.post('/api/projects', {
			data: { name: 'Health failure', folders: [root], primaryPath: root }
		});
		const project = (await response.json()).project as { id: string };
		projectId = project.id;
		let repositoryRequests = 0;
		let healthRequests = 0;
		await controlIdleCallbacks(page);
		await page.route(`/api/projects/${project.id}/sessions`, (route) =>
			route.fulfill({ json: { sessions: [] } })
		);
		await page.route(`/api/projects/${project.id}/repository`, (route) => {
			repositoryRequests += 1;
			return route.fulfill({
				json: {
					isRepository: true,
					branch: 'startup-ready',
					changes: [],
					worktrees: [],
					remotes: []
				}
			});
		});
		await page.route(`**/api/health?projectId=${project.id}`, (route) => {
			healthRequests += 1;
			return route.fulfill({ status: 503, json: { error: 'Health unavailable' } });
		});

		await page.goto(`/?project=${project.id}`);
		const workbench = page.getByRole('region', { name: 'Health failure workbench' });
		await expect(
			page.getByRole('navigation', { name: 'Project tools' }).getByRole('button', { name: /^Git/ })
		).toBeVisible();
		expect(repositoryRequests).toBe(0);
		expect(healthRequests).toBe(0);
		await runIdleCallbacks(page);
		await page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: /^Git/ })
			.click();
		await expect(workbench.getByRole('article', { name: 'Git status' })).toContainText(
			'startup-ready'
		);
		await expect(page.getByRole('region', { name: 'Runtime health' })).toContainText(
			'Health unavailable'
		);
		expect(repositoryRequests).toBe(2);
		expect(healthRequests).toBe(1);
	} finally {
		if (projectId) await page.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test('switches between Git repositories discovered inside a project', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-write']);
	const requests: string[] = [];
	const diffScopes: string[] = [];
	await page.route(/\/api\/projects\/[^/]+\/repository(?:\?.*)?$/, async (route) => {
		const url = new URL(route.request().url());
		const repositoryPath = url.searchParams.get('repository') ?? 'app';
		if (url.searchParams.get('view') === 'diff') {
			diffScopes.push(url.searchParams.get('scope') ?? '');
			return route.fulfill({
				json: {
					scope: url.searchParams.get('scope'),
					base: url.searchParams.get('scope') === 'branch' ? 'main' : null,
					diff: `diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old value\n+new value\n@@ -10 +10 @@\n-old footer\n+new footer\ndiff --git a/src/other.ts b/src/other.ts\n--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-old other\n+new other\n`,
					truncated: true,
					maxBytes: 100000,
					untrackedPaths: [],
					untrackedPathsTruncated: false
				}
			});
		}
		requests.push(repositoryPath);
		await route.fulfill({
			json: {
				isRepository: true,
				branch: repositoryPath === 'app' ? 'feature/app' : 'docs',
				changes: [
					{
						path: repositoryPath === 'app' ? 'src/app.ts' : 'guide.md',
						index: ' ',
						worktree: 'M',
						fileUrl: null
					}
				],
				worktrees: [],
				remotes: [],
				repositoryPath,
				repositories: [{ path: 'app' }, { path: 'docs' }]
			}
		});
	});
	await addProject(page);
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /^Git/ }).click();

	const gitPanel = page.getByRole('article', { name: 'Git status' });
	const selector = gitPanel.getByRole('combobox', { name: 'Repository' });
	await expect(selector).toHaveValue('app');
	await expect(gitPanel).toContainText('src/app.ts');
	const review = gitPanel.getByRole('region', { name: 'Diff review' });
	await expect(review).toContainText('Diff output was limited to 100,000 bytes');
	await review.getByRole('button', { name: 'Next hunk' }).click();
	await expect(review).toContainText('@@ -10 +10 @@');
	await review.getByRole('combobox', { name: 'Changed file' }).selectOption('src/other.ts');
	await review.getByRole('button', { name: /Addition, new line 1: new other/ }).click();
	await review.getByRole('button', { name: 'Copy selected lines' }).click();
	await expect(review).toContainText('Selected lines copied.');
	await review.getByRole('combobox', { name: 'Diff scope' }).selectOption('branch');
	await expect.poll(() => diffScopes).toContain('branch');
	await selector.selectOption('docs');
	await expect(gitPanel).toContainText('guide.md');
	expect(requests).toContain('docs');
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
		{ width: 320, height: 700 }
	]) {
		await page.setViewportSize(viewport);
		if (viewport.width <= 390) {
			const toolsButton = page.getByRole('button', { name: 'Open Project tools' });
			if (await toolsButton.isVisible()) await toolsButton.click();
			const gitButton = page.getByRole('button', { name: 'Git', exact: true });
			if (await gitButton.isVisible()) await gitButton.click();
		}
		await expect(selector).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			expect((await selector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		if (viewport.width <= 390) {
			for (const control of [
				review.getByRole('combobox', { name: 'Diff scope' }),
				review.getByRole('combobox', { name: 'Changed file' }),
				review.getByRole('button', { name: 'Refresh diff' })
			]) {
				expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			}
		}
	}
});

test('opens project-scoped browser, terminal, Git status, and worktree panels', async ({
	page
}) => {
	let projectId = '';
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-workbench-'));
	try {
		await page.unroute('**/api/projects/*/terminal**');
		const browserErrors: string[] = [];
		page.on(
			'console',
			(message) => message.type() === 'error' && browserErrors.push(message.text())
		);
		page.on('pageerror', (error) => browserErrors.push(error.message));
		page.on('requestfailed', (request) => recordRequestFailure(browserErrors, request));
		let previewRequests = 0;
		await page.route('http://localhost:4001/**', (route) => {
			previewRequests += 1;
			return route.fulfill({
				contentType: 'text/html',
				body: '<h1>HUE browser canvas fixture</h1>'
			});
		});
		await page.route('http://canvas.test/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<h1>HUE canvas fixture</h1>' })
		);
		const gitActions: string[] = [];
		let changes = [{ path: 'app/src/routes/+page.svelte', index: ' ', worktree: 'M' }];
		await page.route(/\/api\/projects\/[^/]+\/repository\?view=diff/, (route) =>
			route.fulfill({
				json: {
					scope: 'unstaged',
					base: null,
					diff: '',
					truncated: false,
					maxBytes: 100_000,
					untrackedPaths: [],
					untrackedPathsTruncated: false
				}
			})
		);
		await page.route(/\/api\/projects\/[^/]+\/repository\?view=github/, (route) =>
			route.fulfill({
				json: {
					issueGroups: [
						{
							milestone: 'M1',
							issues: [
								{
									number: 42,
									title: 'Group project work',
									url: 'https://github.com/curi/hue/issues/42'
								}
							]
						}
					],
					pullRequests: [
						{ number: 44, title: 'Review project work', url: 'https://github.com/curi/hue/pull/44' }
					]
				}
			})
		);
		await page.route(/\/api\/projects\/[^/]+\/repository$/, async (route) => {
			if (route.request().method() === 'POST') {
				const body = (await route.request().postDataJSON()) as { action: string };
				gitActions.push(body.action);
				if (body.action === 'stage') changes = [{ ...changes[0], index: 'M', worktree: ' ' }];
				if (body.action === 'commit') changes = [];
			}
			await route.fulfill({
				json: {
					isRepository: true,
					branch: 'feature/workbench',
					changes,
					worktrees: [
						{ path: '/work/hue', branch: 'feature/workbench', head: '1234567890abcdef' },
						{ path: '/work/review', branch: 'review', head: 'abcdef1234567890' }
					],
					remotes: [
						{
							name: 'origin',
							webUrl: 'https://github.com/curi/hue'
						}
					]
				}
			});
		});
		const projectsResponse = await page.request.get('/api/projects');
		const projectsBody = (await projectsResponse.json()) as {
			projects: Array<{ id: string; name: string }>;
		};
		for (const project of projectsBody.projects.filter(({ name }) =>
			name.startsWith('HUE workbench fixture')
		))
			await page.request.delete(`/api/projects/${project.id}`);
		const projectResponse = await page.request.post('/api/projects', {
			data: {
				name: `HUE workbench fixture ${Date.now()}`,
				folders: [projectRoot],
				primaryPath: projectRoot
			}
		});
		if (!projectResponse.ok())
			throw new Error(`${projectResponse.status()}: ${await projectResponse.text()}`);
		projectId = ((await projectResponse.json()).project as { id: string }).id;
		await page.goto(`/?project=${projectId}`);
		await page.keyboard.press('Escape');

		const workbench = page.getByRole('region', { name: /HUE workbench/ });
		const browser = page.getByRole('article', { name: 'Project browser' });
		await expect(browser).toBeVisible();
		const projectTools = page.getByRole('navigation', { name: 'Project tools' });
		await projectTools.getByRole('button', { name: 'Terminal', exact: true }).click();
		const terminal = page.getByRole('article', { name: 'Project terminal' });
		await expect(terminal.getByTitle('Open Terminal 1')).toBeVisible();
		await terminal.getByRole('application', { name: 'Interactive project terminal' }).click();
		await page.keyboard.type('printf HUE_PTY_OK');
		await page.keyboard.press('Enter');
		await expect(terminal.locator('.xterm-rows')).toContainText('HUE_PTY_OK');
		await projectTools.getByRole('button', { name: /^Git/ }).click();
		await expect(workbench.getByRole('article', { name: 'Git status' })).toContainText(
			'app/src/routes/+page.svelte'
		);
		await expect(workbench.getByRole('article', { name: 'Git worktrees' })).toContainText('review');
		const github = workbench.getByRole('article', { name: 'GitHub work' });
		await expect(github).toContainText('M1');
		await expect(github).toContainText('#42 Group project work');
		await github.getByText('M1', { exact: true }).click();
		await expect(github.getByText('#42 Group project work')).toBeHidden();
		await github
			.getByLabel('GitHub pull requests')
			.getByText('Pull requests', { exact: true })
			.click();
		await expect(github.getByText('#44 Review project work')).toBeHidden();
		await expect
			.poll(() =>
				page.evaluate(
					(id) => localStorage.getItem(`hue:project-tools:${id}:github-pulls-open`),
					projectId
				)
			)
			.toBe('false');
		expect(
			await page.evaluate(
				(id) =>
					JSON.parse(
						localStorage.getItem(`hue:project-tools:${id}:github-milestones-open`) ?? '{}'
					),
				projectId
			)
		).toMatchObject({ M1: false });
		await expect(workbench.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
			'href',
			'https://github.com/curi/hue/pulls'
		);
		const commitModelTrigger = workbench.getByRole('button', { name: 'Commit message model' });
		await expect(commitModelTrigger).toHaveText('');
		await commitModelTrigger.click();
		await expect(page.getByRole('dialog', { name: 'Choose commit message model' })).toBeVisible();
		await page.keyboard.press('Escape');
		await workbench.getByRole('button', { name: 'Stage app/src/routes/+page.svelte' }).click();
		await workbench
			.getByRole('textbox', { name: 'Commit message', exact: true })
			.fill('Workbench actions');
		await workbench.getByRole('button', { name: 'Commit and push staged changes' }).click();
		await expect.poll(() => gitActions).toEqual(['stage', 'commit', 'push']);

		await expect(browser.getByRole('button', { name: 'Browser', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await browser.getByRole('button', { name: 'Excalidraw' }).click();
		await expect(browser.getByRole('button', { name: 'Excalidraw' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await browser.getByRole('button', { name: 'Browser', exact: true }).click();
		await expect(browser.getByRole('button', { name: 'New browser tab' })).toBeVisible();
		const browserPreview = browser.getByLabel('Browser view');
		await browserPreview.getByLabel('Browser address').fill('http://localhost:4001');
		await browserPreview.getByRole('button', { name: 'Go' }).click();
		await expect(browserPreview.locator('iframe[title="localhost"]')).toBeVisible();
		const savedBrowserTabs = await page.evaluate((id) => {
			const key = `hue:browser:${id}`;
			return { key, value: localStorage.getItem(key) };
		}, projectId);
		expect(savedBrowserTabs.key).not.toBe('');
		await browser.getByRole('button', { name: 'Excalidraw' }).click();
		await browser.getByRole('button', { name: 'Browser', exact: true }).click();
		await expect(browserPreview.locator('iframe[title="localhost"]')).toBeVisible();
		expect(previewRequests).toBe(1);
		await browser.getByRole('button', { name: 'Excalidraw' }).click();
		const canvas = browser.getByLabel('Excalidraw view');
		await canvas.getByLabel('Browser address').fill('not a url');
		await canvas.getByRole('button', { name: 'Go' }).click();
		await expect(canvas.getByRole('alert')).toContainText('Enter a valid http or https address');
		await canvas.getByLabel('Browser address').fill('http://canvas.test');
		await canvas.getByRole('button', { name: 'Go' }).click();
		await expect
			.poll(async () => {
				const body = await (await page.request.get(`/api/projects/${projectId}/excalidraw`)).json();
				return body.state?.address;
			})
			.toBe('http://canvas.test/');
		await canvas.getByRole('button', { name: 'Add desktop' }).click();
		await canvas.getByRole('button', { name: 'Add tablet' }).click();
		await canvas.getByRole('button', { name: 'Add mobile' }).click();
		await expect(canvas.locator('.browser-embed iframe')).toHaveCount(3);
		await expect(canvas.locator('iframe[title*="Desktop"]')).toHaveAttribute('width', '1440');
		await expect(canvas.locator('iframe[title*="Tablet (768 × 1024)"]')).toHaveAttribute(
			'width',
			'768'
		);
		await expect(canvas.locator('iframe[title*="Mobile"]')).toHaveAttribute('width', '390');
		for (const frame of await canvas.locator('iframe').all()) {
			await expect(frame).toHaveAttribute(
				'sandbox',
				'allow-forms allow-modals allow-popups allow-same-origin allow-scripts'
			);
			await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
		}
		await expect
			.poll(async () => {
				const body = await (await page.request.get(`/api/projects/${projectId}/excalidraw`)).json();
				const scene = JSON.parse(body.state?.scene || '{}') as {
					elements?: Array<{ type: string; width: number; height: number }>;
				};
				return (scene.elements ?? [])
					.filter(({ type }) => type === 'embeddable')
					.map(({ width, height }) => ({ width, height }));
			})
			.toEqual([
				{ width: 1440, height: 900 },
				{ width: 768, height: 1024 },
				{ width: 390, height: 844 }
			]);
		expect(await page.evaluate((key) => localStorage.getItem(key), savedBrowserTabs.key)).toBe(
			savedBrowserTabs.value
		);
		const previewHealth = page.locator('[data-health-id="preview"]');
		await expect(previewHealth).toContainText('canvas.test');
		await browser.getByRole('button', { name: 'Browser', exact: true }).click();
		await expect(previewHealth).toContainText('localhost:4001');
		await browser.getByRole('button', { name: 'Excalidraw' }).click();
		await expect(previewHealth).toContainText('canvas.test');

		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			if (viewport.width <= 700) {
				const entry = page.getByRole('button', { name: 'Open Project tools' });
				if (await entry.isVisible()) await entry.click();
				const projectTools = workbench.getByRole('navigation', { name: 'Project tools' });
				await projectTools.getByRole('button', { name: 'Browser', exact: true }).click();
				await expect(workbench.getByRole('article', { name: 'Project browser' })).toBeVisible();
				await projectTools.getByRole('button', { name: 'Terminal', exact: true }).click();
				await expect(workbench.getByRole('article', { name: 'Project terminal' })).toBeVisible();
				await projectTools.getByRole('button', { name: 'Git', exact: true }).click();
				await expect(workbench.getByRole('article', { name: 'Git status' })).toBeVisible();
				await projectTools.getByRole('button', { name: 'Browser', exact: true }).click();
				await expect(workbench.getByRole('article', { name: 'Project browser' })).toBeVisible();
			}
			await browser.getByRole('button', { name: 'Browser', exact: true }).click();
			await expect(browserPreview).toBeVisible();
			if (viewport.width <= 390)
				await expectMinimumTouchTargets(
					browserPreview.locator(
						'.browser-tabs button, .browser-address input, .browser-address button'
					)
				);
			await browser.getByRole('button', { name: 'Excalidraw' }).click();
			await expect(workbench).toBeVisible();
			const browserBox = await browser.boundingBox();
			expect(browserBox).not.toBeNull();
			expect(browserBox!.x).toBeGreaterThanOrEqual(0);
			expect(browserBox!.x + browserBox!.width).toBeLessThanOrEqual(viewport.width);
			if (viewport.width <= 1200)
				expect(
					await page.locator('.project-workbench').evaluate((element) => ({
						overflowX: getComputedStyle(element).overflowX,
						scrollLeft: element.scrollLeft
					}))
				).toEqual({ overflowX: 'hidden', scrollLeft: 0 });
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			if (viewport.width <= 390)
				await expectMinimumTouchTargets(
					canvas.locator(
						'.browser-canvas-toolbar button, .browser-canvas-toolbar a, .browser-canvas-toolbar input'
					)
				);
			if (process.env.HUE_CAPTURE_BROWSER_CANVAS)
				await browser.screenshot({ path: `/tmp/hue-browser-canvas-${viewport.width}.png` });
		}
		expect(browserErrors).toEqual([]);
	} finally {
		if (projectId) await page.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
		rmSync(projectRoot, { recursive: true, force: true });
	}
});

test('groups GitHub issues by collapsible milestone lists', async ({ page }) => {
	await page.route(/\/api\/projects\/[^/]+\/repository\?view=github/, (route) =>
		route.fulfill({
			json: {
				issueGroups: [
					{
						milestone: 'M1',
						issues: [
							{
								number: 42,
								title: 'Group project work',
								url: 'https://github.com/curi/hue/issues/42'
							}
						]
					}
				],
				pullRequests: [
					{ number: 44, title: 'Review project work', url: 'https://github.com/curi/hue/pull/44' }
				]
			}
		})
	);
	await page.route(/\/api\/projects\/[^/]+\/repository$/, (route) =>
		route.fulfill({
			json: {
				isRepository: true,
				branch: 'main',
				changes: [],
				worktrees: [],
				remotes: [{ name: 'origin', webUrl: 'https://github.com/curi/hue' }]
			}
		})
	);
	await addProject(page);
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Git', exact: true }).click();

	const github = page.getByRole('article', { name: 'GitHub work' });
	await expect(github.getByRole('link', { name: 'Open curi/hue on GitHub' })).toHaveAttribute(
		'href',
		'https://github.com/curi/hue'
	);
	await expect(github).toContainText('Milestone');
	await expect(github).toContainText('M1');
	await expect(github.getByText('#42 Group project work')).toBeVisible();
	await github.getByText('M1', { exact: true }).click();
	await expect(github.getByText('#42 Group project work')).toBeHidden();
	await github
		.getByLabel('GitHub pull requests')
		.getByText('Pull requests', { exact: true })
		.click();
	await expect(github.getByText('#44 Review project work')).toBeHidden();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await expectMinimumTouchTargets(github.locator('summary'));
});

test('remounts project-scoped tools when switching projects', async ({ page }) => {
	await page.unroute('**/api/projects/*/terminal**');
	const roots = [
		mkdtempSync(join(tmpdir(), 'hue-workbench-a-')),
		mkdtempSync(join(tmpdir(), 'hue-workbench-b-'))
	];
	const projects: Array<{ id: string; name: string }> = [];
	const terminalActions: Array<{ projectId: string; action: string }> = [];
	try {
		for (const [index, rootPath] of roots.entries()) {
			const response = await page.request.post('/api/projects', {
				data: { name: `Lifecycle ${index + 1}`, folders: [rootPath], primaryPath: rootPath }
			});
			projects.push((await response.json()).project);
		}
		await page.route(/\/api\/projects\/([^/]+)\/repository$/, (route) => {
			const projectId =
				route
					.request()
					.url()
					.match(/projects\/([^/]+)\//)?.[1] ?? '';
			return route.fulfill({
				json: {
					isRepository: true,
					branch: projectId === projects[0].id ? 'branch-one' : 'branch-two',
					changes: [],
					worktrees: [],
					remotes: []
				}
			});
		});
		await page.route(/\/api\/projects\/([^/]+)\/terminal(?:\?.*)?$/, async (route) => {
			const projectId =
				route
					.request()
					.url()
					.match(/projects\/([^/]+)\//)?.[1] ?? '';
			if (route.request().method() === 'GET') {
				return route.fulfill({
					json: { output: '', cursor: 0, inputSequence: 0, reset: false, status: 'running' }
				});
			}
			const body = (await route.request().postDataJSON()) as { action: string };
			terminalActions.push({ projectId, action: body.action });
			return route.fulfill({
				json:
					body.action === 'create'
						? { terminalId: `${projectId}-terminal`, cursor: 0, status: 'running' }
						: { success: true }
			});
		});

		await page.goto(`/?project=${projects[0].id}`);
		await page.evaluate(
			({ projectId }) =>
				localStorage.setItem(
					`hue:browser:${projectId}`,
					JSON.stringify([{ id: 'bad', title: 'Bad', url: 'javascript:alert(1)' }])
				),
			{ projectId: projects[0].id }
		);
		await page.reload();
		await expect(
			page.getByRole('article', { name: 'Project browser' }).getByLabel('Browser address')
		).toHaveValue('');
		const projectTools = page.getByRole('navigation', { name: 'Project tools' });
		await projectTools.getByRole('button', { name: /^Git/ }).click();
		await expect(
			page.getByRole('article', { name: 'Git status' }).getByText('branch-one', { exact: true })
		).toBeVisible();
		await projectTools.getByRole('button', { name: 'Terminal', exact: true }).click();
		await expect
			.poll(() =>
				terminalActions.some(
					({ projectId, action }) => projectId === projects[0].id && action === 'create'
				)
			)
			.toBe(true);
		await expect(page.getByTitle('Open Terminal 1')).toBeVisible();
		const firstBrowser = page.getByRole('article', { name: 'Project browser' });
		await firstBrowser.getByRole('button', { name: 'Excalidraw' }).click();
		const firstCanvas = firstBrowser.getByLabel('Excalidraw view');
		await firstCanvas.getByLabel('Browser address').fill('http://localhost:4001');
		await firstCanvas.getByRole('button', { name: 'Go' }).click();
		await firstCanvas.getByRole('button', { name: 'Add mobile' }).click();
		await expect
			.poll(async () => {
				const body = await (
					await page.request.get(`/api/projects/${projects[0].id}/excalidraw`)
				).json();
				return JSON.parse(body.state?.scene || '{}').elements?.length ?? 0;
			})
			.toBeGreaterThan(0);
		await expect(firstCanvas.locator('iframe[title*="Mobile"]')).toHaveCount(1);
		await page.locator('.project-select').filter({ hasText: projects[1].name }).click();

		await page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: /^Git/ })
			.click();
		await expect(
			page.getByRole('article', { name: 'Git status' }).getByText('branch-two', { exact: true })
		).toBeVisible();
		await page
			.getByRole('article', { name: 'Project browser' })
			.getByRole('button', { name: 'Excalidraw' })
			.click();
		await expect(
			page
				.getByRole('article', { name: 'Project browser' })
				.getByLabel('Excalidraw view')
				.getByLabel('Browser address')
		).toHaveValue('');
		await expect(
			page.getByRole('article', { name: 'Project browser' }).locator('.browser-embed iframe')
		).toHaveCount(0);
		await page
			.getByRole('navigation', { name: 'Project tools' })
			.getByRole('button', { name: 'Terminal', exact: true })
			.click();
		await expect
			.poll(() => terminalActions)
			.toContainEqual({ projectId: projects[0].id, action: 'close' });
		await page.locator('.project-select').filter({ hasText: projects[0].name }).click();
		await page
			.getByRole('article', { name: 'Project browser' })
			.getByRole('button', { name: 'Excalidraw' })
			.click();
		await expect(
			page.getByRole('article', { name: 'Project browser' }).locator('iframe[title*="Mobile"]')
		).toHaveCount(1);
		await page.reload();
		await page
			.getByRole('article', { name: 'Project browser' })
			.getByRole('button', { name: 'Excalidraw' })
			.click();
		await expect(
			page.getByRole('article', { name: 'Project browser' }).locator('iframe[title*="Mobile"]')
		).toHaveCount(1);
		await expect
			.poll(() =>
				terminalActions.some(
					({ projectId, action }) => projectId === projects[1].id && action === 'create'
				)
			)
			.toBe(true);
	} finally {
		for (const project of projects)
			await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	}
});
