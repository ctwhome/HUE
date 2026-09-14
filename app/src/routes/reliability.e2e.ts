import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const viewports = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 844 }];

async function historyFixture(page: Page, hasLocal: boolean) {
	let fullReads = 0;
	await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => route.fulfill({ json: {
		projectId: null, reconciliation: 'complete', hasMore: false,
		sessions: [{ sessionId: 'history-fixture', cwd: '/tmp', title: 'History fixture', harness: hasLocal ? 'hermes' : 'opencode' }]
	} }));
	await page.route(/\/api\/sessions\/history-fixture(?:\?.*)?$/, (route) => {
		const full = route.request().url().includes('history=full');
		if (full && ++fullReads === 1) return route.fulfill({ status: 503, json: { error: 'History temporarily unavailable' } });
		return route.fulfill({ json: {
			transcript: full ? [{ role: 'user', text: 'Older question' }, { role: 'assistant', text: 'Older answer' }] : [],
			messages: hasLocal ? [{ id: 'local', text: 'Local question', images: [], attachments: [], status: 'completed' }] : [],
			events: hasLocal ? [{ sequence: 1, type: 'message.accepted', payload: { messageId: 'local' } },
				{ sequence: 2, type: 'agent.chunk', payload: { messageId: 'local', text: 'Local answer' } }] : [],
			cursor: hasLocal ? 2 : 0, activeTurn: null, runtime: { profile: 'default', harness: hasLocal ? 'hermes' : 'opencode' },
			history: { mode: full ? 'full' : 'recent', complete: full, fullUrl: '/api/sessions/history-fixture?history=full' }
		} });
	});
	return () => fullReads;
}

test('fast resolved startup waits for router readiness at every shell size', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	let reads = 0;
	await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => {
		reads++;
		return route.fulfill({ json: { sessions: [], reconciliation: 'complete', projectId: null } });
	});
	// Buffer the complete document so Project reconciliation is already available at hydration.
	await page.route(/\/\?project=none$/, async (route) => {
		const response = await route.fetch();
		await route.fulfill({ response, body: await response.text() });
	});
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const before = reads;
		await page.goto('/?project=none');
		await expect.poll(() => reads).toBeGreaterThan(before);
		await expect(page.locator('.workspace.ready')).toBeVisible();
	}
	expect(errors).toEqual([]);
});

for (const hasLocal of [true, false]) {
	test(`history failure stays visible and retry restores older messages (${hasLocal ? 'local tail' : 'import'})`, async ({ page }) => {
		const reads = await historyFixture(page, hasLocal);
		await page.goto('/?project=none&session=history-fixture');
		if (hasLocal) {
			await expect(page.getByText('Local answer', { exact: true })).toBeVisible();
			expect(reads()).toBe(0);
			await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
		}
		await expect(page.getByRole('alert')).toContainText('History temporarily unavailable');
		await expect(page.getByRole('heading', { name: /^Start this/ })).toHaveCount(0);
		if (hasLocal) await expect(page.getByText('Local answer', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Retry history loading', exact: true }).click();
		await expect(page.getByText('Older answer', { exact: true })).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		expect(reads()).toBe(2);
	});
}

test('tablet Project selection and editing have separate pointer targets', async ({ page }) => {
	const root = mkdtempSync(join(tmpdir(), 'hue-pointer-targets-'));
	let projectId: string | undefined;
	try {
		const created = await page.request.post('/api/projects', { data: { name: 'Pointer targets', folders: [root], primaryPath: root } });
		expect(created.ok()).toBe(true);
		const { project } = await created.json() as { project: { id: string; name: string } };
		projectId = project.id;
	await page.route(/\/api\/projects\/[^/]+\/sessions(?:\?.*)?$/, (route) => route.fulfill({ json: { sessions: [] } }));
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto('/?project=none');
	const row = page.getByRole('group', { name: `Project ${project.name}`, exact: true });
	const select = row.getByRole('button', { name: project.name, exact: true });
	await expect(select).toBeVisible();
	const edit = row.getByRole('button', { name: `Edit ${project.name}`, exact: true });
	const selectedBox = (await select.boundingBox())!;
	const editBox = (await edit.boundingBox())!;
	expect(editBox.y, JSON.stringify({ selectedBox, editBox, styles: await edit.evaluate(el => ({ position: getComputedStyle(el).position, translate: getComputedStyle(el).translate })) })).toBeGreaterThanOrEqual(selectedBox.y + selectedBox.height);
	await select.hover();
	expect(await select.evaluate((element) => {
		const box = element.getBoundingClientRect();
		return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
	})).toBe(true);
	expect(editBox.width).toBeGreaterThanOrEqual(44);
	expect(editBox.height).toBeGreaterThanOrEqual(44);
	await select.click();
	await expect(select).toHaveAttribute('aria-current', 'page');
	await edit.click();
	await expect(page.locator('.project-manager-popover')).toBeVisible();
	} finally {
		try { if (projectId) await page.request.delete(`/api/projects/${projectId}`); }
		finally { rmSync(root, { recursive: true, force: true }); }
	}
});
