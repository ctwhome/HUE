import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

test('settings controls, JSON editor, external edits and another browser share one file', async ({ page, browser, request }) => {
	const initial = await (await request.get('/api/settings')).json();
	const other = await browser.newPage();
	try {
		await page.goto('/');
		await other.goto('/');
		await page.getByRole('button', { name: 'App settings', exact: true }).click();
		await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('nord');
		await expect.poll(() => JSON.parse(readFileSync(initial.path, 'utf8')).preferences.theme).toBe('nord');
		await expect(other.locator('html')).toHaveAttribute('data-theme', 'nord');
		await page.getByRole('button', { name: 'Edit settings.json', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'settings.json' });
		await expect(editor).toHaveValue(/"theme": "nord"/);
		await editor.fill('{ bad json');
		await page.getByRole('button', { name: 'Save settings', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Edit HUE settings JSON' }).getByRole('alert')).toBeVisible();
		expect(JSON.parse(readFileSync(initial.path, 'utf8')).preferences.theme).toBe('nord');
		const changed = JSON.parse(readFileSync(initial.path, 'utf8'));
		changed.preferences.theme = 'oled';
		await editor.fill(JSON.stringify(changed, null, 2));
		await page.getByRole('button', { name: 'Save settings', exact: true }).click();
		await expect(page.getByText('Saved. Your settings now apply across HUE.')).toBeVisible();
		await expect(other.locator('html')).toHaveAttribute('data-theme', 'oled');
		changed.preferences.theme = 'light';
		writeFileSync(initial.path, JSON.stringify(changed, null, 2) + '\n');
		await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
		changed.preferences.theme = 'dark';
		await editor.fill(JSON.stringify(changed, null, 2));
		await page.getByRole('button', { name: 'Save settings', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Edit HUE settings JSON' }).getByRole('alert')).toContainText('changed');
		expect(JSON.parse(readFileSync(initial.path, 'utf8')).preferences.theme).toBe('light');
	} finally {
		writeFileSync(initial.path, JSON.stringify(initial.settings, null, 2) + '\n');
		await other.close();
	}
});
