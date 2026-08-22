import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
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

function sessionButton(page: import('@playwright/test').Page, title: string) {
	return page.locator('.session-select').filter({ hasText: title });
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
	const projectsMenu = page.locator('.mobile-navigation').getByRole('button', { name: 'Projects' });
	if (await projectsMenu.isVisible()) await projectsMenu.click();
	const existing = page.locator('.project-rail nav .project-select').filter({ hasText: 'HUE' });
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

test('recovers missing Project roots with Locate, Remove, or projectless continuation', async ({
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
			data: { name: `Missing ${viewport.width}`, rootPath: retiredRoot }
		});
		const project = (await created.json()).project as { id: string };
		rmSync(retiredRoot, { recursive: true, force: true });

		try {
			await page.setViewportSize(viewport);
			await page.goto(`/?project=${project.id}`);
			const recovery = page.getByRole('region', { name: 'Project folder unavailable' });
			await expect(recovery).toBeVisible();
			await expect(page.getByRole('region', { name: /workbench/ })).toHaveCount(0);
			for (const label of ['Locate', 'Remove', 'Open without Project'])
				await expect(recovery.getByRole('button', { name: label, exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			if (viewport.width <= 390) await expectMinimumTouchTargets(recovery.locator('button'));

			if (index === 0) {
				await recovery.getByRole('button', { name: 'Open without Project' }).click();
				await expect(page).toHaveURL(/project=none/);
			} else if (index === 1) {
				await recovery.getByRole('button', { name: 'Remove', exact: true }).click();
				await page
					.getByRole('dialog', { name: 'Remove project?' })
					.getByRole('button', { name: 'Remove project' })
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
				await recovery.getByRole('button', { name: 'Locate' }).click();
				await page
					.getByRole('dialog', { name: 'Locate project directory' })
					.getByRole('button', { name: 'Use this directory' })
					.click();
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
	let submittedProject: { name: string; rootPath: string } | undefined;
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
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
	await addProject(page);
	for (const viewport of viewports) {
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

test('renames and removes a project from the projects sidebar', async ({ page }) => {
	test.setTimeout(60_000);
	const rootPath = mkdtempSync(join(tmpdir(), 'hue-edit-project-'));
	const response = await page.request.post('/api/projects', {
		data: { name: 'Editable project', rootPath }
	});
	const project = (await response.json()).project as { id: string; rootPath: string };
	let currentName = 'Editable project';
	try {
		const invalidIcon = await page.request.patch(`/api/projects/${project.id}`, {
			data: { name: currentName, icon: 'data:text/html;base64,PHNjcmlwdD4=' }
		});
		expect(invalidIcon.status()).toBe(400);
		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			await page.goto('/');
			const projectsMenu = page
				.locator('.mobile-navigation')
				.getByRole('button', { name: 'Projects' });
			if (await projectsMenu.isVisible()) await projectsMenu.click();
			const editButton = page.getByRole('button', { name: `Edit ${currentName}` });
			await editButton.click();
			const dialog = page.getByRole('dialog', { name: 'Edit project' });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByLabel('Project directory')).toHaveValue(project.rootPath);
			await dialog.getByRole('button', { name: 'Remove project' }).click();
			const confirmation = page.getByRole('dialog', { name: 'Remove project?' });
			await expect(confirmation).toBeVisible();
			await expect(confirmation).toContainText(
				`Remove ${currentName} from HUE? Hermes transcripts will not be deleted.`
			);
			if (viewport.width <= 390) await expectMinimumTouchTargets(confirmation.locator('button'));
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width
			);
			await confirmation.getByRole('button', { name: 'Cancel' }).click();
			await expect(confirmation).toBeHidden();
			await expect(dialog).toBeVisible();
			if (viewport.width === 1440) {
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
			await dialog.getByRole('button', { name: 'Save changes' }).click();
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
		const editDialog = page.getByRole('dialog', { name: 'Edit project' });
		await editDialog.getByRole('button', { name: 'Remove project' }).click();
		const confirmation = page.getByRole('dialog', { name: 'Remove project?' });
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole('button', { name: 'Remove project' }).click();
		await expect(page.locator('.project-select', { hasText: currentName })).toHaveCount(0);
	} finally {
		if (project) await page.request.delete(`/api/projects/${project.id}`).catch(() => undefined);
		rmSync(rootPath, { recursive: true, force: true });
	}
});

test('keeps unresolved-delivery removal conflict visible with a Locate recovery path', async ({
	page
}) => {
	const rootPath = mkdtempSync(join(tmpdir(), 'hue-project-unknown-delivery-'));
	const created = await page.request.post('/api/projects', {
		data: { name: 'Unknown delivery project', rootPath }
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
			.getByRole('dialog', { name: 'Edit project' })
			.getByRole('button', { name: 'Remove project' })
			.click();
		const confirmation = page.getByRole('dialog', { name: 'Remove project?' });
		await confirmation.getByRole('button', { name: 'Remove project' }).click();

		await expect(confirmation).toBeVisible();
		await expect(confirmation.getByRole('alert')).toContainText(
			'Project has unresolved message delivery'
		);
		await expect(
			confirmation.getByRole('button', { name: 'Locate Project instead' })
		).toBeVisible();
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
			json: { name: 'browser-use', content: '---\nname: browser-use\n---\n\n# Browser Use\n' }
		});
	});
	await page.route(/\/api\/hermes(?:\?.*)?$/, (route) => {
		const view = new URL(route.request().url()).searchParams.get('view');
		const json =
			view === 'skills'
				? { skills: [{ name: 'browser-use', category: '', source: 'local', status: 'enabled' }] }
				: view === 'schedules'
					? {
							jobs: [
								{ id: 'job-1', name: 'Monthly check', schedule: '0 9 1 * *', status: 'active' }
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

test('sends one complete envelope and renders streamed completion', async ({ page }) => {
	const captured: { envelope?: { messageId: string; text: string } } = {};
	const browserErrors: string[] = [];
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
		await new Promise((resolve) => setTimeout(resolve, 250));
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

	await addProject(page);
	await sessionButton(page, 'Send').click();
	const text = 'Complete message 🧭 with final words intact.';
	await page.getByLabel('Message Hermes').fill(text);
	await page.getByRole('button', { name: 'Send', exact: true }).click();

	await expect(page.getByText('Hermes reasoning')).toBeVisible();
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

test('copies, edits, and forks transcript messages', async ({ page, context }) => {
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
	await userMessage.getByRole('button', { name: 'Fork session' }).click();
	await expect(page.locator('.selected-session-title')).toContainText('Forked session');
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
								{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' },
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
							{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' },
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
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const triggerBox = await modelTrigger.boundingBox();
		expect(triggerBox!.width).toBeLessThanOrEqual(150);
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
			const attach = page.getByLabel('Attach images');
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
	await expect(modelTrigger).toContainText('Claude');
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
	await sessionButton(page, 'Queue').click();
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

test('starts a new session without the previous session output', async ({ page }) => {
	const browserErrors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()));
	page.on('pageerror', (error) => browserErrors.push(error.message));
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
	await page.route('**/api/projects/*/sessions', async (route) => {
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
	await page.getByRole('button', { name: 'Workflows' }).click();
	await expectMinimumTouchTargets(
		page.locator('#session-drawer button, #session-drawer input, #session-drawer textarea')
	);
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
				data: { name: `Lifecycle ${index + 1}`, rootPath }
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
