import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const e2e = readFileSync(new URL('./workspace.e2e.ts', import.meta.url), 'utf8');

test('workflow fields have accessible names', () => {
	expect(page).toContain('aria-label="Workflow name"');
	expect(page).toContain('aria-label="Workflow prompt"');
});

test('mobile changed-shell controls enforce 44px targets', () => {
	expect(styles).toMatch(
		/\.add-project input,\s*\.add-project button,\s*\.tabs button,\s*\.workflow-card button,\s*\.workflow-form input,\s*\.workflow-form textarea,\s*\.workflow-form button,\s*\.composer button\s*\{\s*min-height: 44px;/
	);
});

test('uncertain HTTP acknowledgement exposes an explicit exact-envelope retry', () => {
	expect(page).toContain('onclick={retryPendingMessage}');
	expect(page).toContain('Retry exact message');
});

test('e2e project fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
