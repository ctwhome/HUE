import { expect, test } from '@playwright/test';

const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
	{ width: 320, height: 568 }
];

test.afterEach(async ({ request }) => {
	const response = await request.get('/api/projects');
	const { projects } = (await response.json()) as { projects: Array<{ id: string }> };
	for (const project of projects) await request.delete(`/api/projects/${project.id}`);
});

test('permission consequences and the Session inspector fit the browser matrix', async ({
	page
}, testInfo) => {
	const errors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => errors.push(`${request.method()} ${request.url()}`));

	const projects = (await (await page.request.get('/api/projects')).json()) as {
		projects: Array<{ id: string; name: string }>;
	};
	let project = projects.projects.find(({ name }) => name === 'Inspector test');
	if (!project) {
		const response = await page.request.post('/api/projects', {
			data: { name: 'Inspector test', folders: [process.cwd()], primaryPath: process.cwd() }
		});
		expect(response.ok()).toBe(true);
		project = ((await response.json()) as { project: { id: string; name: string } }).project;
	}

	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) =>
		route.fulfill({
			json: {
				sessions: [
					{
						sessionId: 'session-review',
						cwd: `${process.cwd()}/src`,
						title: 'Review control',
						workMode: 'live',
						attention: true
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-review$/, (route) =>
		route.fulfill({
			json: {
				transcript: [],
				messages: [],
				cursor: 1,
				activeTurn: {
					messageId: 'message-1',
					status: 'running',
					thought: '',
					output: '',
					error: null
				},
				runtime: {
					profile: 'default',
					clarify: { status: 'available' },
					models: {
						currentModelId: 'sonnet',
						availableModels: [{ modelId: 'sonnet', name: 'Claude Sonnet' }]
					},
					modes: {
						currentModeId: 'suggest',
						availableModes: [{ id: 'suggest', name: 'Suggest edits' }]
					},
					usage: { used: 250, size: 1000 }
				},
				events: [
					{
						sequence: 1,
						type: 'agent.permission',
						payload: {
							messageId: 'message-1',
							id: 'permission-1',
							status: 'pending',
							toolCall: {
								name: 'terminal',
								title: 'Run focused checks',
								kind: 'execute',
								args: { command: 'bun test', cwd: process.cwd() }
							},
							options: [
								{ optionId: 'once', name: 'Allow once', kind: 'allow_once' },
								{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }
							]
						}
					}
				]
			}
		})
	);
	await page.route(/\/sessions\/session-review\/events\?after=1$/, (route) =>
		route.fulfill({ json: { events: [] } })
	);
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({ json: { isRepository: false, branch: null, changes: [] } })
	);
	await page.route('**/api/projects/*/terminal**', (route) =>
		route.fulfill({ json: { output: '', cursor: 0, status: 'running', exitCode: null } })
	);

	await page.goto('/');
	const projectButton = page.locator('.project-select').filter({ hasText: 'Inspector test' });
	if ((await projectButton.getAttribute('aria-current')) !== 'page')
		await projectButton.click({ position: { x: 80, y: 22 } });
	await page.locator('.session-select').filter({ hasText: 'Review control' }).click();
	const permission = page.getByRole('group', { name: 'Permission required: Run focused checks' });
	await expect(permission).toContainText('terminal');
	await expect(permission).toContainText('Review control');
	await expect(permission).toContainText('bun test');
	await expect(permission).toContainText('lets Hermes run a command');
	await expect(permission.getByRole('button')).toHaveCount(2);

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.getByRole('button', { name: 'Inspect Session context' }).click();
		const inspector = page.getByRole('dialog', { name: 'Session inspector' });
		await expect(inspector).toBeVisible();
		await expect(inspector).toContainText('Inspector test');
		await expect(inspector).toContainText(`${process.cwd()}/src`);
		await expect(inspector).toContainText('Live');
		await expect(inspector).toContainText('Claude Sonnet');
		await expect(inspector).toContainText('25% (250 of 1,000 tokens)');
		await expect(inspector).toContainText('Permission: Run focused checks');
		const box = (await inspector.boundingBox())!;
		expect(box.width).toBeLessThanOrEqual(viewport.width);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		if (viewport.width <= 720) {
			expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
			expect(
				(await inspector.getByRole('button', { name: 'Close Session inspector' }).boundingBox())!
					.height
			).toBeGreaterThanOrEqual(44);
		}
		await testInfo.attach(`session-inspector-${viewport.width}x${viewport.height}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
		await inspector.getByRole('button', { name: 'Close Session inspector' }).click();
	}
	expect(errors).toEqual([]);
});
