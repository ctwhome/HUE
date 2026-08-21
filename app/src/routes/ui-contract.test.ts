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
	expect(page).toMatch(/class="global-action global-docs"\s+href="\/docs\/"\s+target="_blank"/);
	expect(page).toContain('aria-label="Open documentation in a new tab"');
});

test('narrow global rail opens a read-only Hermes inspector', () => {
	expect(page).toContain('<nav class="global-rail" aria-label="Global navigation">');
	expect(styles).toMatch(/grid-template-columns: 56px 220px 320px minmax\(0, 1fr\);/);
	for (const label of ['Workspace', 'Skills', 'Schedules', 'Commands', 'Profiles']) {
		expect(page).toContain(`aria-label="${label}"`);
	}
	expect(page).toContain('aria-label="Inspect Hermes runtime"');
	expect(page).toContain('/api/hermes');
	expect(page).toMatch(/<dialog\s+bind:this=\{hermesDialog\}/);
	expect(page).toContain('Skills are not exposed by Hermes ACP');
	expect(page).toContain('Schedules are not exposed by Hermes ACP');
	expect(styles).toMatch(
		/\.hermes-dialog \.icon-button,\s*\.hermes-sections summary\s*\{\s*min-height: 44px;/
	);
});

test('mobile changed-shell controls enforce 44px targets', () => {
	expect(styles).toMatch(
		/\.section-heading button,\s*\.add-project input,\s*\.add-project button,\s*\.tabs button,\s*\.workflow-card button,\s*\.workflow-form input,\s*\.workflow-form textarea,\s*\.workflow-form button,\s*\.composer button,\s*\.attach-button,\s*\.context-chip\s*\{\s*min-height: 44px;/
	);
});

test('composer uses a command-first toolbar with an accessible icon send action', () => {
	expect(page).toContain("'Message Hermes… / for commands'");
	expect(page).toContain('class="composer-send"');
	expect(page).toContain('aria-label="Send"');
	expect(styles).toMatch(/\.composer-context\s*\{[^}]*margin-left: auto;[^}]*overflow-x: auto;/s);
});

test('project creation is opened from the Projects heading in a dialog', () => {
	expect(page).toContain('aria-label="Add project"');
	expect(page).toContain('onclick={openAddProject}');
	expect(page).toContain('/api/directories?');
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

test('only the latest user question sticks to the top of the transcript', () => {
	expect(styles).toMatch(
		/\.transcript article\.user:not\(:has\(~ article\.user\)\)\s*\{[^}]*position: sticky;[^}]*top: 0;/s
	);
});

test('only active turns reserve space below the transcript', () => {
	expect(styles).toMatch(/\.transcript\.turn-active:has\(article\.user\)::after/);
});

test('user message wrapping does not render template whitespace', () => {
	expect(styles).toMatch(/\.user-message p\s*\{[^}]*white-space: pre-wrap;/s);
});

test('e2e project fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
