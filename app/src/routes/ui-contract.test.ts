import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const e2e = readFileSync(new URL('./workspace.e2e.ts', import.meta.url), 'utf8');

test('workflow fields have accessible names', () => {
	expect(page).toContain('aria-label="Workflow name"');
	expect(page).toContain('aria-label="Workflow prompt"');
});

test('brand header links to the bundled documentation', () => {
	expect(page).toMatch(/class="docs-link"\s+href="\/docs\/"\s+target="_blank"/);
	expect(page).toContain('aria-label="Open documentation in a new tab"');
});

test('mobile changed-shell controls enforce 44px targets', () => {
	expect(styles).toMatch(
		/\.section-heading button,\s*\.add-project input,\s*\.add-project button,\s*\.tabs button,\s*\.workflow-card button,\s*\.workflow-form input,\s*\.workflow-form textarea,\s*\.workflow-form button,\s*\.composer button\s*\{\s*min-height: 44px;/
	);
});

test('project creation is opened from the Projects heading in a dialog', () => {
	expect(page).toContain('aria-label="Add project"');
	expect(page).toContain('addProjectDialog.showModal()');
	expect(page).toMatch(/<dialog\s+bind:this=\{addProjectDialog\}/);
});

test('uncertain HTTP acknowledgement exposes an explicit exact-envelope retry', () => {
	expect(page).toContain('onclick={retryPendingMessage}');
	expect(page).toContain('Retry exact message');
});

test('historical unknown delivery is not shown as a current Hermes connection error', () => {
	expect(page).toContain("error = body.transcriptError ?? '';");
});

test('long chats scroll inside the transcript without growing the workspace', () => {
	expect(styles).toMatch(/\.workspace\s*\{[^}]*height: 100dvh;[^}]*overflow: hidden;/s);
	expect(styles).toMatch(/\.session-view\s*\{[^}]*min-height: 0;[^}]*overflow: hidden;/s);
	expect(styles).toMatch(/\.transcript\s*\{[^}]*min-height: 0;[^}]*overflow: auto;/s);
});

test('e2e project fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
