import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('frontend dependencies and source follow the application policy', async () => {
	const packageJson = read('../../package.json');
	const css = read('../app.css');
	const html = read('../../src/app.html');
	const notices = read('../../../THIRD_PARTY_NOTICES.md');
	const appRoot = fileURLToPath(new URL('../..', import.meta.url));
	const paths = [...new Bun.Glob('src/**/*.{svelte,ts}').scanSync(appRoot)];
	const productionPaths = paths.filter(
		(path) => !path.includes('.test.') && !path.includes('.e2e.')
	);
	const source = (
		await Promise.all(productionPaths.map((path) => Bun.file(`${appRoot}/${path}`).text()))
	).join('\n');
	const interfaceComponents = (
		await Promise.all(
			productionPaths
				.filter((path) => path.includes('/components/') && path.endsWith('.svelte'))
				.filter((path) => !path.endsWith('/GitHubMark.svelte'))
				.map((path) => Bun.file(`${appRoot}/${path}`).text())
		)
	).join('\n');

	expect(css).toContain("@import 'tailwindcss'");
	expect(css).toContain("@import '@fontsource-variable/inter'");
	expect(packageJson).toContain('"unplugin-icons"');
	expect(packageJson).toContain('"@iconify-json/lucide"');
	expect(packageJson).not.toContain('"lucide-svelte"');
	expect(html).toContain('viewport-fit=cover');
	expect(notices).toContain('CC0 1.0 Universal');
	expect(source).toContain("from '~icons/lucide/");
	expect(interfaceComponents).not.toContain('<svg');
	expect(source).not.toContain(['/Users', 'ctw'].join('/') + '/');
});
