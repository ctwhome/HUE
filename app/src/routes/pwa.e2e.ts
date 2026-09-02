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
const e2eOrigin = `http://127.0.0.1:${Number(process.env.HUE_E2E_PORT ?? 44014)}`;

function captureBrowserErrors(page: import('@playwright/test').Page) {
	const errors: string[] = [];
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => {
		if (!(request.method() === 'HEAD' && request.url().includes('/_app/immutable/')))
			errors.push(`${request.method()} ${request.url()}`);
	});
	page.on('response', (response) => {
		if (response.status() >= 400)
			errors.push(`${response.request().method()} ${response.url()} ${response.status()}`);
	});
	return errors;
}

async function mockProjectlessSessions(page: import('@playwright/test').Page) {
	let creates = 0;
	let sends = 0;
	await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { sessions: [] } });
		creates += 1;
		return route.fulfill({
			status: 201,
			json: {
				session: {
					sessionId: `capture-${creates}`,
					cwd: '/tmp/hue-projectless',
					title: 'Captured idea'
				},
				commands: []
			}
		});
	});
	await page.route(/\/api\/sessions\/capture-\d+\/messages$/, (route) => {
		sends += 1;
		return route.fulfill({ json: { accepted: true } });
	});
	return { creates: () => creates, sends: () => sends };
}

async function mockSuccessfulWorkbench(page: import('@playwright/test').Page) {
	await page.route('/api/health?projectId=*', (route) => route.fulfill({ json: { checks: [] } }));
	await page.route('**/api/projects/*/repository', (route) =>
		route.fulfill({
			json: { isRepository: false, branch: null, changes: [], worktrees: [], remotes: [] }
		})
	);
	await page.route('**/api/projects/*/sessions', (route) =>
		route.fulfill({ json: { sessions: [] } })
	);
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
					? { terminalId: 'pwa-terminal', cursor: 0, status: 'running' }
					: { success: true }
		});
	});
}

test('manifest and service worker expose install metadata with static-only versioned cache', async ({
	page
}) => {
	const browserErrors = captureBrowserErrors(page);
	const manifest = await (await page.request.get('/manifest.webmanifest')).json();
	expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone' });
	await mockProjectlessSessions(page);
	await page.goto('/');
	const cache = await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		const keys = await caches.keys();
		const requests = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys())))
			.flat()
			.map(({ url }) => new URL(url).pathname);
		return { keys, requests };
	});
	expect(cache.keys).toHaveLength(1);
	expect(cache.keys[0]).toMatch(/^hue-static-/);
	expect(cache.requests.length).toBeGreaterThan(0);
	expect(cache.requests.every((path) => path.startsWith('/_app/immutable/'))).toBe(true);
	expect(cache.requests.some((path) => path === '/' || path.startsWith('/api/'))).toBe(false);
	expect(browserErrors).toEqual([]);
});

test('quick capture is immediate, draft-safe, explicit-create-only, and responsive', async ({
	page
}) => {
	const browserErrors = captureBrowserErrors(page);
	const calls = await mockProjectlessSessions(page);
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		await page.goto('/?intent=capture');
		const dialog = page.getByRole('dialog', { name: 'Quick Idea' });
		await expect(dialog).toBeVisible();
		await expect(page.getByLabel('Idea or message draft')).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width
		);
		const box = (await dialog.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		for (const button of await dialog.getByRole('button').all()) {
			if (await button.isVisible())
				expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		await page.getByRole('button', { name: 'Keep draft for later' }).click();
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/?intent=capture');
	const composer = page.getByLabel('Idea or message draft');
	await composer.fill('Unsent private capture');
	await composer.press('Enter');
	expect(calls.creates()).toBe(0);
	expect(calls.sends()).toBe(0);
	await page.getByRole('button', { name: 'Keep draft for later' }).click();
	await page.goto('/?intent=capture');
	await expect(composer).toHaveValue('Unsent private capture\n');
	await expect(page.getByLabel('Session Project')).toHaveValue('');
	await page.getByRole('button', { name: 'Create Session' }).click();
	await expect(page).toHaveURL(/project=none&session=capture-1/);
	expect(calls.creates()).toBe(1);
	expect(calls.sends()).toBe(0);
	await expect(page.getByLabel('Message Hermes')).toHaveValue('Unsent private capture\n');
	expect(browserErrors).toEqual([]);
});

test('share target consumes private intake once without URL disclosure or auto-submit', async ({
	page
}) => {
	const browserErrors = captureBrowserErrors(page);
	const calls = await mockProjectlessSessions(page);
	await page.goto('/');
	const origin = new URL(page.url()).origin;
	const response = await page.request.post('/share', {
		maxRedirects: 0,
		headers: { origin },
		multipart: {
			title: 'Private shared title',
			text: 'Private shared body',
			url: 'https://example.test/private',
			files: {
				name: 'shared.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from('shared file bytes')
			}
		}
	});
	expect(response.status(), await response.text()).toBe(303);
	const location = response.headers().location;
	expect(location).not.toContain('Private');
	await page.setViewportSize({ width: 320, height: 844 });
	await page.goto(location);
	await expect(page.getByLabel('Idea or message draft')).toHaveValue(
		'Private shared title\n\nPrivate shared body\n\nhttps://example.test/private'
	);
	await expect(page.getByText('shared.txt', { exact: false })).toBeVisible();
	expect(page.url()).not.toContain('Private');
	expect(page.url()).not.toContain('token=');
	expect(calls.creates()).toBe(0);
	expect(calls.sends()).toBe(0);
	expect(browserErrors).toEqual([]);
});

test('production share target enforces Origin and configured parser bounds', async ({
	request
}) => {
	for (const origin of [undefined, 'https://attacker.test']) {
		const response = await request.post('/share', {
			maxRedirects: 0,
			headers: origin ? { origin } : undefined,
			multipart: { text: 'private origin probe' }
		});
		expect(response.status()).toBe(403);
		expect(await response.text()).not.toContain('private origin probe');
	}

	const accepted = await request.post('/share', {
		maxRedirects: 0,
		headers: { origin: e2eOrigin },
		multipart: {
			files: {
				name: 'large.txt',
				mimeType: 'text/plain',
				buffer: Buffer.alloc(1024 * 1024, 0x61)
			}
		}
	});
	expect(accepted.status(), await accepted.text()).toBe(303);

	const rejected = await request.post('/share', {
		headers: { origin: e2eOrigin, 'content-type': 'application/octet-stream' },
		data: Buffer.alloc(2_000_001)
	});
	expect(rejected.status()).toBe(400);
	expect(await rejected.text()).toBe('Shared content was rejected');
});

test('shortcut launch contracts consume intent and retain native share intake', async ({
	page
}) => {
	const defaultRoot = mkdtempSync(join(tmpdir(), 'hue-pwa-default-project-'));
	const created = await page.request.post('/api/projects', {
		data: { name: 'PWA default Project', folders: [defaultRoot], primaryPath: defaultRoot }
	});
	const defaultProject = (await created.json()).project as { id: string };
	await mockSuccessfulWorkbench(page);
	const browserErrors = captureBrowserErrors(page);
	const calls = await mockProjectlessSessions(page);
	try {
		await page.goto('/?intent=new-session');
		await expect(page).toHaveURL(/project=none&session=capture-1/);
		expect(page.url()).not.toContain('intent=');
		expect(calls.creates()).toBe(1);

		await page.goto('/?intent=projects');
		await expect(page).toHaveURL(/project=none/);
		expect(page.url()).not.toContain('intent=');
		await expect(page.getByRole('button', { name: 'Start a chat' })).toBeVisible();
		await expect(page.getByRole('button', { name: /install|pin/i })).toHaveCount(0);
		expect(browserErrors).toEqual([]);
	} finally {
		await page.request.delete(`/api/projects/${defaultProject.id}`).catch(() => undefined);
		rmSync(defaultRoot, { recursive: true, force: true });
	}
});
