import { expect, test } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 844 }
];
const mobileViewports = viewports.slice(-2);

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

function sessionButton(page: import('@playwright/test').Page, title: string) {
	return page.locator('.session-select').filter({ hasText: title });
}

async function openMobileProjects(page: import('@playwright/test').Page) {
	const button = page.locator('.mobile-navigation').getByRole('button', { name: 'Projects' });
	if (!(await button.isVisible())) return;
	await expect(button).toBeEnabled();
	if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
}

async function mockProjectWorkbenchRequests(page: import('@playwright/test').Page) {
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({
			json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
		})
	);
	await page.route('**/api/projects/*/sessions', (route) =>
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
		await existing.click();
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
	await page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }).click();
}

async function removeProjects(page: import('@playwright/test').Page) {
	const response = await page.request.get('/api/projects');
	const body = (await response.json()) as { projects: Array<{ id: string }> };
	for (const project of body.projects) await page.request.delete(`/api/projects/${project.id}`);
}

test.beforeEach(async ({ page }) => {
	await mockTerminalRequests(page);
	await mockDefaultSessionRequests(page);
});

test('Project file workspace stays usable across required viewports', async ({
	page
}, testInfo) => {
	test.setTimeout(60_000);
	await page.setViewportSize(viewports[0]);
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await page.route('**/api/projects/*/files**', async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === 'POST')
			return route.fulfill({ status: 409, json: { error: 'File changed outside HUE' } });
		if (url.searchParams.get('mode') === 'preview')
			return route.fulfill({
				json:
					url.searchParams.get('path') === 'README.md'
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
		return route.fulfill({
			json: {
				entries: [
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
	await page.getByRole('treeitem', { name: /README.md/ }).click();
	await expect(page.getByRole('heading', { name: 'README.md' })).toBeVisible();
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
	await page.getByRole('button', { name: 'Edit Markdown' }).click();
	await page.getByLabel('File content').fill('# Unsaved');
	await page.getByRole('button', { name: 'Workflows', exact: true }).click();
	await page.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
	expect(
		await page.evaluate(() =>
			document
				.querySelector('.context-panel .tabs button:nth-child(2)')
				?.classList.contains('active')
		)
	).toBe(true);
	await page.getByRole('button', { name: 'Keep editing' }).click();
	await page.setViewportSize(viewports[0]);
	expect(await page.evaluate(() => window.innerWidth)).toBe(viewports[0].width);
	expect(await page.evaluate(() => matchMedia('(max-width: 700px)').matches)).toBe(false);
	for (const action of [
		page.getByRole('button', { name: 'Refresh files' }),
		page.getByRole('button', { name: 'Develop' }),
		...[
			'Settings',
			'Inspect Hermes runtime',
			'Schedules',
			'Skills',
			'Commands',
			'Profiles',
			'MCP'
		].map((name) =>
			page.getByRole('navigation', { name: 'Global navigation' }).getByRole('button', { name })
		),
		page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }),
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
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'Settings' })
		.click();
	await page.getByRole('button', { name: 'Discard changes' }).click();
	await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'Workspace' })
		.click();
	await expect(page.getByRole('region', { name: 'Project files' })).toBeVisible();
	await expect(
		page
			.getByRole('navigation', { name: 'Project workbench views' })
			.getByRole('button', { name: 'Files', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'Inspect Hermes runtime' })
		.click();
	await expect(page.getByRole('region', { name: 'Hermes management' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to workspace' }).click();
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
	expect(browserErrors.filter((message) => !message.includes('409 (Conflict)'))).toEqual([]);
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
	await expect(page.getByRole('button', { name: 'Start without Project' })).toBeVisible();
	await expect(page.getByText('No PTY', { exact: true })).toHaveCount(0);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(page.getByRole('main').locator('button'));
	}
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
					.getByRole('dialog', { name: 'Edit Hermes Project' })
					.getByRole('button', { name: 'Add folder' })
					.click();
				await page
					.getByRole('dialog', { name: `Add folder to Missing ${viewport.width}` })
					.getByRole('button', { name: 'Add this folder' })
					.click();
				const editor = page.getByRole('dialog', { name: 'Edit Hermes Project' });
				await editor
					.locator('div.rounded-lg', { hasText: replacementRoot })
					.getByRole('button', { name: 'Make primary' })
					.click();
				await editor.getByRole('button', { name: 'Done' }).click();
				await expect(page.getByRole('region', { name: /workbench/ })).toBeVisible();
				const health = page.getByRole('region', { name: 'Runtime health' });
				for (const label of ['Project', 'Git', 'Terminal', 'Preview', 'Hermes ACP', 'Hermes admin'])
					await expect(health.getByText(label, { exact: true })).toBeVisible();
				await page.unroute(/\/api\/directories/);
			}
		} finally {
			await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
			rmSync(replacementRoot, { recursive: true, force: true });
		}
	}
});

test('reports current saved Preview address with visible touch-safe action text', async ({
	page
}) => {
	await page.route('http://preview.test/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<h1>Preview ready</h1>' })
	);
	await addProject(page);
	const health = page.getByRole('region', { name: 'Runtime health' });
	const preview = health.locator('[data-health-id="preview"]');

	await expect(preview).toContainText('No saved address');
	await expect(preview).toContainText('Enter address in Browser panel');
	await page.getByLabel('Browser address').fill('http://preview.test');
	await page.getByRole('button', { name: 'Go', exact: true }).click();

	await expect(preview).toContainText('preview.test');
	await expect(preview).toContainText('Preview saved in Browser panel');
	await page.setViewportSize({ width: 320, height: 844 });
	await expect(preview).toBeVisible();
	expect((await preview.boundingBox())?.height).toBeGreaterThanOrEqual(44);
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
			const dialog = page.getByRole('dialog', { name: 'Edit Hermes Project' });
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
			await expect(dialog).toBeVisible();
			if (viewport.width === 1440) {
				const secondFolder = dialog.locator('div.rounded-lg', { hasText: secondRoot });
				await secondFolder.getByPlaceholder('Optional label').fill('Docs');
				await secondFolder.getByRole('button', { name: 'Save label' }).click();
				await secondFolder.getByRole('button', { name: 'Make primary' }).click();
				const firstFolder = dialog.locator('div.rounded-lg', { hasText: rootPath });
				await firstFolder.getByRole('button', { name: 'Remove' }).click();
				await expect(dialog.getByText(rootPath, { exact: true })).toHaveCount(0);
				await dialog.getByRole('button', { name: 'Choose project emoji' }).click();
				const picker = dialog.locator('emoji-picker');
				await expect(picker).toBeVisible();
				await picker.getByRole('combobox', { name: 'Search' }).fill('rocket');
				await picker.getByRole('option', { name: /rocket/i }).click();
				await expect(dialog.locator('.project-icon-preview')).toHaveText('🚀');
			}
			if (viewport.width === 390) {
				await dialog.getByLabel('Project icon image').setInputFiles({
					name: 'project.png',
					mimeType: 'image/png',
					buffer: Buffer.from(
						'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
						'base64'
					)
				});
				await expect(dialog.getByRole('img', { name: 'Project icon preview' })).toBeVisible();
			}
			if (viewport.width === 320) {
				await dialog.getByRole('button', { name: 'Choose project emoji' }).click();
				await expect(
					dialog.locator('emoji-picker').getByRole('combobox', { name: 'Search' })
				).toBeVisible();
			}
			const renamed = `Renamed ${viewport.width}`;
			await dialog.getByLabel('Project name').fill(renamed);
			await dialog.getByRole('button', { name: 'Save name and icon' }).click();
			currentName = renamed;
			const renamedProject = page.locator('.project-select', { hasText: currentName });
			await expect(renamedProject).toBeAttached();
			if (viewport.width === 1440) {
				await renamedProject.click();
				await expect(page.locator('.selected-project-title .title-icon')).toHaveText('🚀');
			}
			if (viewport.width < 390) {
				await expect(page.locator('.project-select .project-icon-image')).toBeVisible();
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
		}
		await page.getByRole('button', { name: `Edit ${currentName}` }).click();
		const editDialog = page.getByRole('dialog', { name: 'Edit Hermes Project' });
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
			.getByRole('dialog', { name: 'Edit Hermes Project' })
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
	await expect(page.locator('.session-select .session-icon')).toHaveText('👋');
	await page.getByRole('button', { name: 'Edit Friendly greeting' }).click();
	const dialog = page.getByRole('dialog', { name: 'Edit session icon' });
	await dialog.getByRole('button', { name: 'Choose session emoji' }).click();
	const picker = dialog.locator('emoji-picker');
	await picker.getByRole('combobox', { name: 'Search' }).fill('bug');
	await picker.getByRole('option', { name: /bug/i }).first().click();
	await dialog.getByRole('button', { name: 'Save icon' }).click();
	expect(savedIcon).toBe('🐛');
	await expect(page.locator('.session-select .session-icon')).toHaveText('🐛');
	await page.locator('.session-select').click();
	await expect(page.locator('.selected-session-title .title-icon')).toHaveText('🐛');

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
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
			expect(projectsBox.x).toBe(railBox.width);
			await globalRail.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
		} else {
			await expect(globalRail).toBeHidden();
			await page
				.getByRole('navigation', { name: 'Workspace navigation' })
				.getByRole('button', { name: 'Settings' })
				.click();
			await page
				.getByRole('region', { name: 'Settings' })
				.locator('.settings-grid')
				.getByRole('button', { name: 'Runtime' })
				.click();
		}
		const panel = page.getByRole('region', { name: 'Hermes management' });
		await expect(panel).toBeVisible();
		await expect(panel.getByText('hermes-agent 0.2.0')).toBeVisible();
		await panel.getByRole('button', { name: 'Skills' }).click();
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
		await panel.getByRole('button', { name: 'Schedules' }).click();
		await expect(panel.getByRole('heading', { name: 'Scheduled jobs' })).toBeVisible();
		await expect(panel.getByText('Monthly check')).toBeVisible();
		await panel.getByRole('button', { name: 'Profiles' }).click();
		await expect(panel.getByRole('heading', { name: 'Profiles' })).toBeVisible();
		await expect(panel.getByText('gpt-5.6-sol')).toBeVisible();
		await panel.getByRole('button', { name: 'MCP' }).click();
		await expect(panel.getByRole('heading', { name: 'MCP servers' })).toBeVisible();
		await expect(panel.getByText('filesystem', { exact: true })).toBeVisible();
		await expect(panel.getByText('mcp-filesystem')).toBeVisible();
		await panel.getByRole('button', { name: 'Commands' }).click();
		await expect(panel.getByRole('heading', { name: 'Session commands' })).toBeVisible();
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(panel.locator('button'));
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await panel.getByRole('button', { name: 'Back to workspace' }).click();
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
		await globalNavigation.getByRole('button', { name: 'Skills' }).click();
		const panel = page.getByRole('region', { name: 'Hermes management' });
		await panel.getByRole('button', { name: 'browser-use' }).click();
		const editor = panel.getByLabel('Skill content');
		const edited = '---\nname: browser-use\n---\n\n# Unsaved Browser Use\n';
		await editor.fill(edited);

		await globalNavigation.getByRole('button', { name: 'Workspace' }).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(editor).toHaveValue(edited);

		await panel.getByRole('button', { name: 'Back to workspace' }).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(editor).toHaveValue(edited);

		await page.setViewportSize({ width: 390, height: 844 });
		const projectsMenu = page
			.getByRole('navigation', { name: 'Workspace navigation' })
			.getByRole('button', { name: 'Projects' });
		await projectsMenu.click();
		await page.getByTitle(`Open Dirty skill target · ${targetRoot}`).click();
		await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
		await page.getByRole('button', { name: 'Keep editing' }).click();
		await expect(editor).toHaveValue(edited);
		await projectsMenu.click();
		expect(
			await page.evaluate(() => {
				const event = new Event('beforeunload', { cancelable: true });
				return !window.dispatchEvent(event);
			})
		).toBe(true);

		await panel.getByRole('button', { name: 'Back to workspace' }).click();
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
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
	await page
		.getByRole('navigation', { name: 'Global navigation' })
		.getByRole('button', { name: 'Settings' })
		.click();
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
			await page
				.getByRole('navigation', { name: 'Global navigation' })
				.getByRole('button', { name: 'Settings' })
				.click();
		} else {
			await page
				.getByRole('navigation', { name: 'Workspace navigation' })
				.getByRole('button', { name: 'Settings' })
				.click();
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
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
	await page.getByRole('button', { name: 'Skills', exact: true }).click();
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
		if (viewport.width > 700) {
			await page.getByRole('button', { name: 'Skills', exact: true }).click();
		} else {
			await page
				.getByRole('navigation', { name: 'Workspace navigation' })
				.getByRole('button', { name: 'Settings' })
				.click();
			await page
				.getByRole('region', { name: 'Settings' })
				.locator('.settings-grid')
				.getByRole('button', { name: 'Skills' })
				.click();
		}
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
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
	await mockProjectWorkbenchRequests(page);
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				jobs: [
					{
						id: 'monthly',
						name: 'Monthly check',
						schedule: '0 9 1 * *',
						status: 'active',
						nextRun: 'Sep 1, 09:00',
						lastRun: 'Aug 1, 09:00'
					},
					{ id: 'digest', name: 'Daily digest', schedule: '0 8 * * *', status: 'active' },
					{ id: 'cleanup', name: 'Weekly cleanup', schedule: '0 3 * * 0', status: 'paused' },
					{ id: 'legacy', name: 'Legacy sync', schedule: '0 0 * * *', status: 'disabled' }
				]
			}
		})
	);

	await page.goto('/');
	await expect(page).toHaveURL(/\?project=/);
	await page.getByRole('button', { name: 'Schedules', exact: true }).click();
	const panel = page.getByRole('region', { name: 'Hermes management' });
	const statistics = panel.getByRole('region', { name: 'Schedule statistics' });
	await expect(statistics.getByLabel('4 scheduled jobs')).toBeVisible();
	await expect(statistics.getByLabel('2 active jobs')).toBeVisible();
	await expect(statistics.getByLabel('2 inactive jobs')).toBeVisible();
	await expect(panel.getByText('Last Aug 1, 09:00')).toBeVisible();

	await panel.getByLabel('Filter schedules by status').selectOption('paused');
	await expect(panel.getByText('1 of 4 jobs')).toBeVisible();
	await expect(panel.getByText('Weekly cleanup')).toBeVisible();
	await panel.getByLabel('Filter schedules by status').selectOption('all');
	await panel.getByLabel('Filter scheduled jobs').fill('monthly');
	await expect(panel.getByText('1 of 4 jobs')).toBeVisible();
	await expect(panel.getByText('Monthly check')).toBeVisible();

	await panel.getByLabel('Filter scheduled jobs').fill('');
	await panel.getByLabel('Group schedules').selectOption('status');
	await expect(panel.getByRole('heading', { name: 'Active' })).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Disabled' })).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Paused' })).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		await expect(page).toHaveURL(/\?project=/);
		if (viewport.width > 700) {
			await page.getByRole('button', { name: 'Schedules', exact: true }).click();
		} else {
			await page
				.getByRole('navigation', { name: 'Workspace navigation' })
				.getByRole('button', { name: 'Settings' })
				.click();
			await page
				.getByRole('region', { name: 'Settings' })
				.locator('.settings-grid')
				.getByRole('button', { name: 'Schedules' })
				.click();
		}
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
	await page.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
	await page.getByRole('button', { name: 'Back to workspace' }).click();
	await page.getByRole('button', { name: 'Inspect Hermes runtime' }).click();
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
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
						schedule: '0 9 * * *',
						enabled: true,
						last_status: 'success'
					}
				],
				deliveryTargets: [{ id: 'local', name: 'Local (save only)', home_target_set: true }]
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
		await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
		let panel = page.getByRole('region', { name: 'Settings' });
		await expect(panel.getByRole('region', { name: 'HUE preferences' })).toBeVisible();
		await panel.getByLabel('Theme').selectOption('oled');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
		await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
		panel = page.getByRole('region', { name: 'Settings' });
		await panel.getByRole('button', { name: 'Memory', exact: true }).click();
		panel = page.getByRole('region', { name: 'Hermes management' });
		await expect(panel.getByText('Unavailable upstream')).toBeVisible();
		await panel.getByRole('button', { name: 'Schedules', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Run now' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Run history' })).toBeVisible();
		await panel.getByRole('button', { name: 'MCP', exact: true }).click();
		await expect(panel.getByLabel('MCP bearer token')).toHaveAttribute('type', 'password');
		await panel.getByRole('button', { name: 'Test health & tools' }).click();
		await expect(panel.getByText('search', { exact: false })).toBeVisible();
		await panel.getByRole('button', { name: 'Models', exact: true }).click();
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
	const browserErrors: string[] = [];
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
	});
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
		await new Promise((resolve) => setTimeout(resolve, 3_000));
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
	const text = 'Complete message 🧭 with final words intact.';
	await page.getByLabel('Message Hermes').fill(text);
	await page.getByRole('button', { name: 'Send', exact: true }).click();

	await expect(page.getByText('Hermes reasoning')).toBeVisible();
	await expect(page.locator('.active-thinking')).toHaveCount(1);
	await expect(page.locator('.liquid-thinking-orb')).not.toHaveClass(/gpu-ready/);
	expect(
		await page
			.locator('.liquid-thinking-orb')
			.evaluate((element) => getComputedStyle(element).backgroundImage)
	).not.toBe('none');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(page.locator('.active-thinking')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		expect(
			await page
				.locator('.transcript')
				.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
		).toBeLessThanOrEqual(2);
	}
	await expect(page.getByText('Checking the request before answering.')).toBeHidden();
	await page.getByText('Hermes reasoning').click();
	await expect(page.getByText('Checking the request before answering.')).toBeVisible();
	const assistant = page.locator('.transcript article.assistant');
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	await expect(assistant.getByRole('img', { name: 'Hermes image' })).toBeVisible();
	await expect(page.getByText('completed', { exact: true })).toBeVisible();
	await expect(assistant.locator('strong')).toHaveText('Done');
	await expect(assistant.locator('code')).toHaveText('safely');
	expect(
		await page
			.locator('.transcript')
			.evaluate((element) => getComputedStyle(element, '::after').content)
	).toBe('none');
	for (const viewport of viewports) {
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
	await page.getByRole('button', { name: 'Start voice call' }).click();
	const call = page.getByRole('region', { name: 'Voice call controls' });
	await expect(call.locator('.voice-call-state')).toContainText('listening');
	await expect(call.getByRole('button', { name: 'Mute microphone' })).toBeFocused();
	await call.getByRole('button', { name: 'Mute microphone' }).click();
	await expect(call.locator('.voice-call-state')).toContainText('Muted');
	await call.getByRole('button', { name: 'Unmute microphone' }).click();
	await expect(call.locator('.voice-call-state')).toContainText('listening');

	await page.getByLabel('Message Hermes').fill('Answer this aloud');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
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
	await expect(page.getByRole('button', { name: 'Start voice call' })).toBeFocused();
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

		await scroller.hover();
		await page.mouse.wheel(0, -300);
		await expect(page.getByRole('button', { name: 'Scroll to latest message' })).toHaveClass(
			/visible/
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
		await page.getByRole('button', { name: 'Scroll to latest message' }).click();
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		await scroller.hover();
		await page.mouse.wheel(0, -300);
		if (viewport.width <= 700) {
			await page.locator('.mobile-navigation').getByRole('button', { name: 'Sessions' }).click();
		}
		await sessionButton(page, 'Other').click();
		await expect
			.poll(async () =>
				scroller.evaluate(
					(element) => element.scrollHeight - element.scrollTop - element.clientHeight
				)
			)
			.toBeLessThan(2);
		if (viewport.width <= 700) {
			await page.locator('.mobile-navigation').getByRole('button', { name: 'Sessions' }).click();
		}
		await sessionButton(page, 'Sticky').click();
		await scroller.hover();
		await page.mouse.wheel(0, -300);
		failOtherRefresh = true;
		if (viewport.width <= 700) {
			await page.locator('.mobile-navigation').getByRole('button', { name: 'Sessions' }).click();
		}
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
	await page.route('**/api/projects/*/sessions', (route) => route.fulfill({ json: { sessions } }));
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
		if (viewport.width <= 390) await expectMinimumTouchTargets(userMessage.locator('button'));
	}
	await userMessage.getByRole('button', { name: 'Copy message' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		'Please inspect this message'
	);
	await userMessage.getByRole('button', { name: 'Edit and resend message' }).click();
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Please inspect this message');
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

test('discovers Hermes slash commands and sends an attached image', async ({ page }) => {
	let envelope: { text: string; images: Array<{ name: string; mimeType: string; data: string }> };
	let selectedModel = '';
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
			selectedModel = ((await route.request().postDataJSON()) as { modelId: string }).modelId;
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
							{
								modelId: 'openai:gpt-5.6',
								name: 'OpenAI work subscription · GPT 5.6'
							},
							{ modelId: 'openai:gpt-5.6-mini', name: 'GPT 5.6 Mini' },
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
	await sessionButton(page, 'Rich input').click();
	await expect(page.getByText('default', { exact: true })).toBeVisible();
	await expect(page.getByText('main', { exact: true })).toBeVisible();
	await expect(page.getByText('25%', { exact: true })).toBeVisible();
	const modelTrigger = page.getByLabel('Hermes model', { exact: true });
	const modelMenu = page.getByRole('menu', { name: 'Choose Hermes model' });
	await expect(modelTrigger).toHaveText(/gpt-5\.6/);
	await expect(modelTrigger).not.toContainText('OpenAI');
	await expect(modelTrigger).not.toContainText('subscription');
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
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
		if (viewport.width <= 390) {
			const composer = page.locator('.composer');
			const context = composer.locator('.composer-context');
			const attach = page.getByLabel('Attach images and files');
			const voiceMessage = page.getByRole('button', { name: 'Record voice message' });
			const voiceCall = page.getByRole('button', { name: 'Start voice call' });
			const send = page.getByRole('button', { name: 'Send', exact: true });
			await expect(attach).toBeVisible();
			await expect(voiceMessage).toBeVisible();
			await expect(voiceCall).toBeVisible();
			await expect(send).toBeVisible();
			await expect(page.getByLabel('Hermes mode', { exact: true })).toBeAttached();
			const [composerBox, contextBox, attachBox, sendBox] = await Promise.all([
				composer.boundingBox(),
				context.boundingBox(),
				attach.boundingBox(),
				send.boundingBox()
			]);
			expect(composerBox!.height).toBeLessThanOrEqual(160);
			expect(contextBox!.y + contextBox!.height).toBeLessThanOrEqual(attachBox!.y);
			expect(attachBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
			expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
			await expectMinimumTouchTargets(
				composer.locator('.attach-button, .context-chip, .composer-send')
			);
			await context.evaluate((element) => (element.scrollLeft = element.scrollWidth));
			await expect(page.getByText('25%', { exact: true })).toBeInViewport();
			await context.evaluate((element) => (element.scrollLeft = 0));
		}
	}
	await modelTrigger.click();
	await expect(modelMenu.getByText('OpenAI', { exact: true })).toBeVisible();
	await expect(modelMenu.getByText('2 models', { exact: true })).toBeVisible();
	await modelMenu.getByText('Anthropic', { exact: true }).click();
	await modelMenu.getByRole('menuitemradio', { name: /Claude/ }).click();
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
	await page.getByLabel('Attach images and files').setInputFiles({
		name: 'draft.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('private draft attachment')
	});
	await expect(page.getByText('draft.txt')).toBeVisible();
	await page.getByLabel('Commands').click();
	await page.getByRole('button', { name: /help/ }).click();

	expect(envelope).toEqual({
		messageId: expect.any(String),
		text: '/help',
		images: [],
		attachments: []
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
}) => {
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
							{ role: 'assistant', text: 'Reviewed.\nMEDIA: output/report.pdf' }
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
								payload: { messageId: 'file-message', text: 'Reviewed.\nMEDIA: output/report.pdf' },
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
	await page.getByLabel('Attach images and files').setInputFiles({
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
	await expect(preview).toHaveAttribute('target', '_blank');
	await expect(download).toHaveAttribute('href', /download=true/);
	const ranged = await preview.evaluate(async (link) => {
		const response = await fetch((link as HTMLAnchorElement).href, {
			headers: { range: 'bytes=5-11' }
		});
		return { status: response.status, contentRange: response.headers.get('content-range') };
	});
	expect(ranged.status).toBe(206);
	expect(ranged.contentRange).toMatch(/^bytes 5-11\//);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390)
			await expectMinimumTouchTargets(
				page.locator('[aria-label="Generated outputs"] a, [aria-label="Generated outputs"] button')
			);
	}
	await page.getByLabel('Message Hermes').focus();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
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
	await expect(page.getByLabel('Message Hermes')).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByLabel('Attach images and files').setInputFiles({
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
});

test('shows durable delegate_task children as a collapsible status and result tree', async ({
	page
}) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
	const tree = page.getByRole('group', { name: '2 subagents' });
	await expect(tree).toBeVisible();
	await expect(tree.getByText('Map moved path references')).toBeVisible();
	await expect(tree.getByText('failed', { exact: true })).toBeVisible();
	await expect(tree.getByText('Found three references.')).toBeHidden();
	await tree.getByText('Map moved path references').click();
	await expect(tree.getByText('Found three references.')).toBeVisible();
	await tree.getByText('2 subagents', { exact: true }).click();
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

test('renders durable ACP activity, todo, approval, clarify, timestamps, and code feedback', async ({
	page
}) => {
	const responses: unknown[] = [];
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
				cursor: 10,
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
						payload: { messageId: 'msg-1', text: 'Private published reasoning' }
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-interactions\/events\?after=10$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route(/\/sessions\/session-interactions\/interactions$/, async (route) => {
		responses.push(await route.request().postDataJSON());
		await route.fulfill({ json: { resolved: true } });
	});

	await addProject(page);
	await expect(sessionButton(page, 'Failed background task')).toHaveAccessibleDescription(
		/failed/i
	);
	await expect(sessionButton(page, 'Interactions')).toHaveAccessibleDescription(/attention/i);
	await sessionButton(page, 'Interactions').click();
	await expect(page.getByText('Hermes ACP · Clarify available')).toBeVisible();
	expect(
		await page
			.locator('[data-timeline-sequence]')
			.evaluateAll((elements) =>
				elements.map((element) => Number(element.getAttribute('data-timeline-sequence')))
			)
	).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10]);
	await expect(page.getByRole('group', { name: 'Read configuration' })).toContainText('425 ms');
	const conversationTimes = page.locator('.transcript article time');
	await expect(conversationTimes).toHaveCount(2);
	await expect(conversationTimes.first()).toHaveAttribute('datetime', '2026-08-22T09:59:59.000Z');
	await expect(conversationTimes.last()).toHaveAttribute('datetime', '2026-08-22T10:00:00.000Z');
	for (const time of await conversationTimes.all()) {
		await expect(time).toHaveText(/^\d{2}:\d{2}$/);
		await expect(time).toHaveAttribute('title', /2026/);
	}
	const toolSummary = page
		.getByRole('group', { name: 'Read configuration' })
		.getByText('Read configuration');
	await toolSummary.focus();
	await toolSummary.press('Enter');
	await expect(page.getByRole('group', { name: 'Read configuration' })).toContainText('[REDACTED]');
	await expect(page.getByRole('region', { name: 'Hermes todo progress' })).toContainText('1 of 2');
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
	await page.getByText('Hermes reasoning').click();
	await expect(page.getByText('Private published reasoning')).toBeVisible();
	await page.getByRole('button', { name: 'Copy code' }).focus();
	await page.getByRole('button', { name: 'Copy code' }).press('Enter');
	await expect(page.getByText('Code copied')).toBeVisible();

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) {
			await expectMinimumTouchTargets(
				page.locator('.activity-card button, .activity-card summary, .code-block button')
			);
		}
	}
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
	await expect(
		page.getByRole('group', { name: 'Permission required: Origin tool' }).getByRole('status')
	).toHaveText('resolved');
	await expect(page.getByRole('button', { name: 'Allow Origin tool' })).toHaveCount(0);
	finishOriginRefresh();
});

test('shows loading beside new session without shifting the session list', async ({ page }) => {
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
		const session = sessionButton(page, 'Loading');
		await expect(session).toBeVisible();
		const before = await session.boundingBox();
		await session.click();
		if (viewport.width <= 700) {
			await expect(page).toHaveURL(/session=session-loading/);
			await expect(page.locator('#session-drawer')).toBeHidden();
			await page.locator('.mobile-navigation').getByRole('button', { name: 'Sessions' }).click();
			await expect
				.poll(async () => (await page.locator('#session-drawer').boundingBox())?.x)
				.toBe(0);
		}

		const indicator = page.getByRole('status', { name: 'Loading project contents' });
		await expect(indicator).toBeVisible();
		expect(await indicator.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
			'none'
		);
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
		await expect(indicator).toHaveCount(0);
		expect((await session.boundingBox())?.y).toBe(before?.y);
	}
});

test('revisits a loaded session immediately while refreshing it', async ({ page }) => {
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
		alphaRequests += 1;
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
	const project = new URL(page.url()).searchParams.get('project');
	await page.goto(`/?project=${project}&session=deep-target`);
	await expect(page.getByText('Deep session restored')).toBeVisible();
	expect(listRequests.at(-1)?.searchParams.get('sessionId')).toBe('deep-target');
	expect(listRequests.at(-1)?.searchParams.has('offset')).toBe(false);
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
		archived: false
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
			json: { transcript: [], messages: [], events: [], cursor: 0, activeTurn: null }
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
	await page.getByRole('searchbox', { name: 'Search Sessions' }).fill('Manage');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	expect(searched).toBe('Manage');
	await sessionButton(page, 'Manage me').click();
	await page.getByRole('button', { name: 'Edit Manage me' }).click();
	await expect(page.getByRole('button', { name: 'Import unavailable' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Import unavailable' })).toHaveAttribute(
		'title',
		'Hermes ACP does not provide a Session import seam'
	);
	await page.getByLabel('Title').fill('Managed');
	await page.getByLabel('Pinned').check();
	await page.getByLabel('Archived', { exact: true }).check();
	await page.getByRole('button', { name: 'Save icon' }).click();
	expect(metadata).toMatchObject({ title: 'Managed', pinned: true, archived: true });
	await expect(sessionButton(page, 'Managed')).toBeVisible();

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

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}
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
			json: { sessions: [{ sessionId: 'session-old', cwd: '/work/hue', title: 'Old' }] }
		});
	});
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
	await sessionButton(page, 'Old').click();
	await expect(page.getByText('Previous session wall of text')).toBeVisible();
	await page.getByRole('button', { name: 'New session', exact: true }).click();

	await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
	await expect(page.getByLabel('Message Hermes')).toBeFocused();
	await expect(page.getByText('Previous session wall of text')).toBeHidden();
	await expect(page.getByText('delivery unknown', { exact: true })).toBeHidden();
	for (const viewport of viewports) {
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

test('starts and revisits a session without a project', async ({ page }) => {
	const browserErrors: string[] = [];
	let creations = 0;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
	page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}`));
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
		const projectsMenu = page
			.locator('.mobile-navigation')
			.getByRole('button', { name: 'Projects' });
		if (await projectsMenu.isVisible()) await projectsMenu.click();
		const expectedCreations = creations + 1;
		await page.getByRole('button', { name: 'New session without a project' }).click();
		await expect.poll(() => creations).toBe(expectedCreations);
		await expect(page.getByRole('heading', { name: 'Start this Hermes Session' })).toBeVisible();
		await expect(page.getByText('No project', { exact: true }).first()).toBeVisible();
		await expect(page.getByLabel('Message Hermes')).toBeFocused();
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
	await expect(page.getByText('delivery unknown', { exact: true })).toBeVisible();
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
	await sessionButton(page, 'Main').click();
	await expect(page).toHaveURL(/\?project=[^&]+&session=session-1$/);

	await expect(page.getByText('Working…')).toBeVisible();
	await expect(page.getByText('running', { exact: true })).toBeVisible();
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
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByLabel('Message Hermes').fill("I'm at the computer");
	await page.getByLabel('Message Hermes').press('Enter');
	await expect(page.getByLabel('Work mode', { exact: true })).toHaveValue('live');

	await page.getByLabel('Message Hermes').fill('/autonomous-delivery');
	await page.getByLabel('Message Hermes').press('Enter');
	await expect(page.getByLabel('Work mode', { exact: true })).toHaveValue('autonomous');
	await expect(page.getByText('/autonomous-delivery')).toHaveCount(0);

	await page.getByLabel('Work mode', { exact: true }).selectOption('live');
	await expect(page.getByLabel('Work mode', { exact: true })).toHaveValue('live');
	await expect(page.getByText('Work mode changed to Live')).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('Work mode', { exact: true })).toHaveValue('live');
	expect(patchBodies).toEqual([{ workMode: 'live' }]);
});

test('mobile uses explicit exclusive Projects and Sessions drawers', async ({ page }) => {
	await page.route('**/api/projects/*/sessions', async (route) =>
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
	await page.getByRole('button', { name: 'Workflows', exact: true }).click();
	await expectMinimumTouchTargets(
		page.locator('#session-drawer button, #session-drawer input, #session-drawer textarea')
	);
});

test('mobile swipe hierarchy tracks, snaps back, excludes native interactions, and dismisses drawers', async ({
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
				transcript: [
					{ role: 'user', text: 'Keep vertical scrolling and text selection native.' },
					{ role: 'assistant', text: 'Gesture fixture ready.' }
				],
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

	for (const viewport of [
		{ width: 320, height: 700 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.emulateMedia({ reducedMotion: viewport.width === 320 ? 'reduce' : 'no-preference' });
		const projectsButton = page
			.locator('.mobile-navigation')
			.getByRole('button', { name: 'Projects' });
		const sessionsButton = page
			.locator('.mobile-navigation')
			.getByRole('button', { name: 'Sessions' });

		await touchDrag(page, { x: 32, y: 300 }, { x: 72, y: 302 });
		await expect(page.locator('#session-drawer')).toBeHidden();
		await touchDrag(page, { x: 32, y: 300 }, { x: 38, y: 410 });
		await expect(page.locator('#session-drawer')).toBeHidden();
		await touchDrag(page, { x: 8, y: 300 }, { x: 180, y: 302 });
		await expect(page.locator('#session-drawer')).toBeHidden();

		const composerBox = (await page.getByLabel('Message Hermes').boundingBox())!;
		await touchDrag(
			page,
			{ x: Math.max(32, composerBox.x + 2), y: composerBox.y + composerBox.height / 2 },
			{ x: 180, y: composerBox.y + composerBox.height / 2 }
		);
		await expect(page.locator('#session-drawer')).toBeHidden();

		await page
			.getByText('Keep vertical scrolling and text selection native.')
			.evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
			});
		await touchDrag(page, { x: 32, y: 300 }, { x: 180, y: 302 });
		await expect(page.locator('#session-drawer')).toBeHidden();
		await page.evaluate(() => window.getSelection()?.removeAllRanges());

		await touchDrag(page, { x: 32, y: 300 }, { x: viewport.width * 0.48, y: 302 }, async () => {
			await expect(page.locator('#session-drawer')).toBeVisible();
			await expect(page.locator('.drawer-backdrop')).toBeVisible();
			const transform = await page
				.locator('#session-drawer')
				.evaluate((element) => getComputedStyle(element).transform);
			expect(transform).not.toBe('none');
			expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
		});
		await expect(page.locator('#session-drawer')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Back to Projects' })).toBeVisible();
		expect(
			(await page.getByRole('button', { name: 'Back to Projects' }).boundingBox())!.height
		).toBeGreaterThanOrEqual(44);
		await expect(page.locator('#session-drawer')).toHaveAttribute('aria-hidden', 'false');
		await expect(page.locator('#project-drawer')).toHaveAttribute('inert', '');
		await expect(page.locator('.drawer-backdrop')).toBeVisible();
		await expectMinimumTouchTargets(page.locator('#session-drawer button'));

		await touchDrag(
			page,
			{ x: 92, y: viewport.height - 110 },
			{ x: 245, y: viewport.height - 108 }
		);
		await expect(page.locator('#project-drawer')).toBeVisible();
		await expect(page.locator('#session-drawer')).toBeHidden();
		await expect(projectsButton).toHaveAttribute('aria-expanded', 'true');
		await expect(sessionsButton).toHaveAttribute('aria-expanded', 'false');

		await touchDrag(
			page,
			{ x: 230, y: viewport.height - 110 },
			{ x: 65, y: viewport.height - 108 }
		);
		await expect(page.locator('#project-drawer')).toBeHidden();
		await expect(page.locator('#session-drawer')).toBeVisible();
		await touchDrag(
			page,
			{ x: 230, y: viewport.height - 110 },
			{ x: 65, y: viewport.height - 108 }
		);
		await expect(page.locator('#session-drawer')).toBeHidden();
		await expect(page.locator('.drawer-backdrop')).toHaveCount(0);

		await sessionsButton.click();
		await expect(page.locator('#session-drawer')).toBeVisible();
		await page.locator('.drawer-backdrop').click({ position: { x: viewport.width - 2, y: 100 } });
		await expect(page.locator('#session-drawer')).toBeHidden();
		await expect(sessionsButton).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
	}

	const sessionsButton = page
		.locator('.mobile-navigation')
		.getByRole('button', { name: 'Sessions' });
	await sessionsButton.click();
	await page.getByRole('button', { name: 'Edit Gesture session' }).click();
	const sessionDialog = page.getByRole('dialog', { name: 'Edit session icon' });
	await expect(sessionDialog).toBeVisible();
	await touchDrag(page, { x: 32, y: 300 }, { x: 180, y: 302 });
	await expect(sessionDialog).toBeVisible();
	await expect(page.locator('#project-drawer')).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(sessionDialog).toBeHidden();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await page.locator('.drawer-backdrop').click({ position: { x: 388, y: 100 } });
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
		await page.getByRole('button', { name: 'Edit Markdown' }).click();
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
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();

	const navigation = page.locator('.mobile-navigation');
	await navigation.getByRole('button', { name: 'Projects' }).click();
	await page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }).click();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/pane=projects/);
	await expect(page.locator('#project-drawer')).toBeVisible();
	await page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' }).click();
	await sessionButton(page, 'Remembered session').click();
	await expect(page.locator('#session-drawer')).toBeHidden();

	await navigation.getByRole('button', { name: 'Sessions' }).click();
	await expect(page).toHaveURL(/pane=sessions/);
	await navigation.getByRole('button', { name: 'Projects' }).click();
	await expect(page).toHaveURL(/pane=projects/);
	await page.goBack();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.locator('#project-drawer')).toBeHidden();
	await page.goBack();
	await expect(page.locator('#session-drawer')).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();
	await expect(navigation.getByRole('button', { name: 'Sessions' })).toBeFocused();

	await navigation.getByRole('button', { name: 'Projects' }).click();
	const projectChoice = page.locator('#project-drawer .project-select').filter({ hasText: 'HUE' });
	await expect(page.locator('#project-drawer')).not.toHaveAttribute('inert', '');
	await projectChoice.evaluate((element) => (element as HTMLElement).focus());
	await page.goBack();
	await expect(page.locator('#project-drawer')).toBeHidden();
	await expect(navigation.getByRole('button', { name: 'Projects' })).toBeFocused();

	await page.evaluate((id) => {
		localStorage.setItem(
			'hue:navigation:v1',
			JSON.stringify({ version: 1, projectId: id, sessionId: 'remembered', pane: 'sessions' })
		);
	}, projectId);
	await page.goto('/');
	await expect(page.locator('#session-drawer')).toBeVisible();
	await page.reload();
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Remembered session' })).toBeVisible();
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
	await expect(page.locator('#session-drawer')).toBeVisible();
	await expect(page).not.toHaveURL(/deleted-session/);

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

test('opens project-scoped browser, terminal, Git status, and worktree panels', async ({
	page
}) => {
	await page.unroute('**/api/projects/*/terminal**');
	const gitActions: string[] = [];
	let changes = [{ path: 'app/src/routes/+page.svelte', index: ' ', worktree: 'M' }];
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
	await addProject(page);
	await page.keyboard.press('Escape');

	const workbench = page.getByRole('region', { name: /HUE workbench/ });
	await expect(workbench.getByRole('article', { name: 'Project browser' })).toBeVisible();
	const terminal = workbench.getByRole('article', { name: 'Project terminal' });
	await expect(terminal.getByRole('tab', { name: /Terminal 1/ })).toBeVisible();
	await terminal.getByRole('application', { name: 'Interactive project terminal' }).click();
	await page.keyboard.type('printf HUE_PTY_OK');
	await page.keyboard.press('Enter');
	await expect(terminal.locator('.xterm-rows')).toContainText('HUE_PTY_OK');
	await expect(workbench.getByRole('article', { name: 'Git status' })).toContainText(
		'app/src/routes/+page.svelte'
	);
	await expect(workbench.getByRole('article', { name: 'Git worktrees' })).toContainText('review');
	await expect(workbench.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
		'href',
		'https://github.com/curi/hue/pulls'
	);
	await workbench.getByRole('button', { name: 'Stage app/src/routes/+page.svelte' }).click();
	await workbench.getByLabel('Commit message').fill('Workbench actions');
	await workbench.getByRole('button', { name: 'Commit & push' }).click();
	await expect.poll(() => gitActions).toEqual(['stage', 'commit', 'push']);

	const browser = workbench.getByRole('article', { name: 'Project browser' });
	await browser.getByRole('button', { name: 'New browser tab' }).click();
	await expect(browser.getByRole('tab')).toHaveCount(2);
	await browser.getByRole('button', { name: 'Close New tab' }).last().click();
	await expect(browser.getByRole('tab')).toHaveCount(1);
	await browser.getByLabel('Browser address').fill('not a url');
	await browser.getByRole('button', { name: 'Go' }).click();
	await expect(browser.getByRole('alert')).toContainText('Enter a valid http or https address');

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await expect(workbench).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 390) await expectMinimumTouchTargets(workbench.locator('button, a'));
	}
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
		await expect(
			page.locator('.session-header').getByText('branch-one', { exact: true })
		).toBeVisible();
		const firstBrowser = page.getByRole('article', { name: 'Project browser' });
		await firstBrowser.getByLabel('Browser address').fill('http://localhost:4001');
		await firstBrowser.getByRole('button', { name: 'Go' }).click();
		await page.locator('.project-select').filter({ hasText: projects[1].name }).click();

		await expect(
			page.locator('.session-header').getByText('branch-two', { exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('article', { name: 'Project browser' }).getByLabel('Browser address')
		).toHaveValue('');
		await expect
			.poll(() =>
				terminalActions.some(
					({ projectId, action }) => projectId === projects[0].id && action === 'close'
				)
			)
			.toBe(true);
		expect(terminalActions).toContainEqual({ projectId: projects[1].id, action: 'create' });
	} finally {
		for (const project of projects)
			await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	}
});
