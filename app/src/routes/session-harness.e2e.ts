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

test('new Sessions expose a responsive Hermes-first harness choice', async ({ page }) => {
	const errors: string[] = [];
	const selected: string[] = [];
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
	page.on('pageerror', (error) => errors.push(error.message));

	const projects = (await (await page.request.get('/api/projects')).json()) as {
		projects: Array<{ id: string; name: string }>;
	};
	let project = projects.projects.find(({ name }) => name === 'Harness test');
	if (!project) {
		const response = await page.request.post('/api/projects', {
			data: { name: 'Harness test', folders: [process.cwd()], primaryPath: process.cwd() }
		});
		expect(response.ok()).toBe(true);
		project = ((await response.json()) as { project: { id: string; name: string } }).project;
		createdProjectIds.push(project.id);
	}

	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, async (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { sessions: [] } });
		const body = route.request().postDataJSON() as { harness?: string };
		selected.push(body.harness ?? 'hermes');
		return route.fulfill({
			status: 201,
			json: {
				session: {
					sessionId: `opencode:session-${selected.length}`,
					externalSessionId: `session-${selected.length}`,
					harness: body.harness ?? 'hermes',
					cwd: process.cwd(),
					title: null,
					workMode: 'autonomous'
				},
				commands: [],
				runtime: { profile: 'default', harness: body.harness ?? 'hermes' },
				branch: null
			}
		});
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto(`/?project=${encodeURIComponent(project.id)}`);
		const addSession = page.getByRole('button', { name: 'Add new session' });
		if (!(await addSession.isVisible())) {
			const back = page.getByRole('button', { name: 'Back to Sessions' });
			if (await back.isVisible()) await back.click();
		}
		await expect(page.getByRole('button', { name: 'Choose new session harness' })).toHaveCount(0);
		await addSession.click();
		const chooser = page.getByRole('radiogroup', { name: 'Harness for this Session' });
		await expect(chooser).toBeVisible();
		await expect(chooser.getByRole('radio', { name: /Hermes/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		const opencode = chooser.getByRole('radio', { name: /OpenCode/ });
		await expect(opencode).toBeVisible();
		expect((await opencode.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		await opencode.click();
		await expect(opencode).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('combobox').fill(`OpenCode ${viewport.width}`);
		await expect(page.getByRole('combobox', { name: 'Message OpenCode' })).toBeVisible();
		await expect(chooser).toHaveCount(0);
		if (!(await addSession.isVisible())) {
			const back = page.getByRole('button', { name: 'Back to Sessions' });
			if (await back.isVisible()) await back.click();
		}
		await addSession.click();
		await expect(
			page
				.getByRole('radiogroup', { name: 'Harness for this Session' })
				.getByRole('radio', { name: /Hermes/ })
		).toHaveAttribute('aria-checked', 'true');
	}

	expect(selected).toEqual(['opencode', 'opencode', 'opencode', 'opencode']);
	expect(errors).toEqual([]);
});
