import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./+layout.svelte', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const e2e = readFileSync(new URL('./workspace.e2e.ts', import.meta.url), 'utf8');

test('workflow fields have accessible names', () => {
	expect(page).toContain('aria-label="Workflow name"');
	expect(page).toContain('aria-label="Workflow prompt"');
});

test('every button and navigation action has a tooltip', () => {
	for (const [control] of page.matchAll(/<(button|a)\b[\s\S]*?<\/\1\s*>/g)) {
		expect(control).toContain('title=');
	}
});

test('tooltips use the app-level styled tooltip provider', () => {
	expect(layout).toContain("import TooltipProvider from '$lib/components/TooltipProvider.svelte'");
	expect(layout).toContain('<TooltipProvider />');
	expect(styles).toMatch(/\.app-tooltip\s*\{[^}]*position: fixed;[^}]*z-index: 100;/s);
});

test('sidebar tooltips prefer collision-aware right placement', () => {
	const tooltip = readFileSync(
		new URL('../lib/components/TooltipProvider.svelte', import.meta.url),
		'utf8'
	);
	expect(tooltip).toContain("trigger.closest('.global-rail')");
	expect(tooltip).toContain('target.right + gap');
	expect(tooltip).toContain('Math.min(innerWidth - tip.width - margin');
});

test('brand header links to the bundled documentation', () => {
	expect(page).toMatch(/class="global-action global-docs"\s+href="\/docs\/"\s+target="_blank"/);
	expect(page).toContain('aria-label="Open documentation in a new tab"');
});

test('narrow global rail opens a read-only Hermes inspector', () => {
	expect(page).toContain('<nav class="global-rail" aria-label="Global navigation">');
	expect(styles).toMatch(/grid-template-columns: 56px 220px 320px minmax\(0, 1fr\);/);
	for (const label of ['Workspace', 'Settings', 'Skills', 'Schedules', 'Commands', 'Profiles']) {
		expect(page).toContain(`aria-label="${label}"`);
	}
	expect(page).toContain('aria-label="Inspect Hermes runtime"');
	expect(page).toContain(
		"aria-label={globalView === 'settings' ? 'Settings' : 'Hermes management'}"
	);
	expect(page).toContain("openHermesPanel('skills')");
	expect(page).toContain("openHermesPanel('schedules')");
	expect(page).toContain("openHermesPanel('profiles')");
	expect(page).not.toContain('Skills are not exposed by Hermes ACP');
});

test('global rail separates workspace messages from Hermes administration', () => {
	expect(page).toContain('<div class="global-admin">');
	expect(styles).toMatch(/\.global-admin\s*{[^}]*margin-top: auto;/s);
});

test('selected projects expose the web-first project workbench', () => {
	for (const panel of ['Project browser', 'Project terminal', 'Git status', 'Git worktrees']) {
		expect(page).toContain(`aria-label="${panel}"`);
	}
	expect(page).toContain('/repository`');
	expect(page).toContain(
		'sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"'
	);
	expect(page).toContain("import { Terminal } from '@xterm/xterm'");
	expect(page).toContain("action: 'stage'");
	expect(page).toContain("action: 'commit'");
	expect(page).toContain("action: 'push'");
	expect(page).not.toContain('Interactive PTY access needs a desktop runtime');
	expect(styles).toMatch(/\.project-workbench\s*\{[^}]*display: grid;/s);
	expect(styles).toMatch(/grid-template-areas:\s*'browser repository'\s*'terminal worktrees';/s);
	expect(page).toContain('inputSequence: Math.max(item.inputSequence, body.inputSequence)');
});

test('mobile changed-shell controls enforce 44px targets', () => {
	expect(styles).toMatch(
		/\.section-heading button,\s*\.add-project input,\s*\.add-project button,\s*\.tabs button,\s*\.workflow-card button,\s*\.workflow-form input,\s*\.workflow-form textarea,\s*\.workflow-form button,\s*\.composer button,\s*\.attach-button,\s*\.context-chip\s*\{\s*min-height: 44px;/
	);
	expect(styles).toMatch(
		/\.browser-address input,\s*\.git-section > header button,\s*\.change-list button\s*\{\s*min-width: 44px;\s*min-height: 44px;/
	);
	expect(styles).toMatch(/\.section-heading \.icon-button\s*\{[^}]*min-width: 44px;/s);
});

test('composer uses a command-first toolbar with an accessible icon send action', () => {
	expect(page).toContain("'Message Hermes… / for commands'");
	expect(page).toContain('class="composer-send"');
	expect(page).toContain('aria-label="Send"');
	expect(styles).toMatch(/\.composer-context\s*\{[^}]*margin-left: auto;[^}]*overflow-x: auto;/s);
});

test('Hermes models use a categorized collapsible popover', () => {
	expect(page).toContain('popover="auto"');
	expect(page).toContain('role="menu"');
	expect(page).toContain('role="menuitemradio"');
	expect(page).toContain('<details');
	expect(styles).toMatch(
		/\.composer \.context-model\s*{[^}]*max-width: 150px;[^}]*background: transparent;/s
	);
	expect(styles).toMatch(
		/\.context-model > span\s*{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/s
	);
	expect(page).not.toContain('<select\n\t\t\t\t\t\t\t\t\taria-label="Hermes model"');
});

test('mobile composer keeps context and input actions in separate rows', () => {
	expect(styles).toMatch(
		/@media \(max-width: 700px\)[\s\S]*\.composer-toolbar\s*{[^}]*grid-template-columns: repeat\(3, 44px\) minmax\(0, 1fr\) 44px;/s
	);
	expect(styles).toMatch(
		/@media \(max-width: 700px\)[\s\S]*\.composer-context\s*{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 1;/s
	);
	expect(styles).toMatch(
		/@media \(max-width: 700px\)[\s\S]*\.composer-toolbar > \.attach-button\s*{[^}]*grid-row: 2;/s
	);
});

test('project creation is opened from the Projects heading in a dialog', () => {
	expect(page).toContain('aria-label="Add project"');
	expect(page).toContain('onclick={openAddProject}');
	expect(page).toContain('/api/directories?');
	expect(page).toMatch(/<dialog\s+bind:this=\{addProjectDialog\}/);
});

test('sessions can be created and revisited without selecting a project', () => {
	expect(page).toContain('aria-label="New session without a project"');
	expect(page).toContain('>No project</span>');
	expect(page).toContain("'/api/sessions'");
});

test('projects can be edited from the project sidebar', () => {
	expect(page).toContain('aria-label={`Edit ${project.name}`}');
	expect(page).toMatch(/<dialog\s+bind:this=\{editProjectDialog\}/);
	expect(page).toContain('aria-label="Project icon image"');
	expect(page).toContain('aria-label="Choose project emoji"');
	expect(page).toContain('<EmojiPicker');
	expect(page).toContain('project-icon-image');
	expect(page).toContain("method: 'PATCH'");
	expect(page).toContain("method: 'DELETE'");
});

test('project and session icons appear in titles and sessions can be customized', () => {
	expect(page).toContain('class="selected-project-title"');
	expect(page).toContain('class="selected-session-title"');
	expect(page).toContain("aria-label={`Edit ${session.title || 'Untitled session'}`}");
	expect(page).toMatch(/<dialog\s+bind:this=\{editSessionDialog\}/);
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

test('user questions remain in transcript flow', () => {
	expect(styles).not.toMatch(/\.transcript article\.user[^}]*position: sticky;/s);
});

test('chat uses an OpenChamber-style bottom follow surface', () => {
	expect(page).toContain('aria-label="Scroll to latest message"');
	expect(page).toContain('disabled={!showScrollToLatest}');
	expect(page).toContain('class="transcript-content"');
	expect(styles).toMatch(/\.transcript\s*\{[^}]*overflow-anchor: none;/s);
	expect(styles).toMatch(/\.transcript-spacer\s*\{[^}]*height: max\(48px, 10vh\);/s);
	expect(styles).not.toMatch(/\.transcript\.turn-active:has\(article\.user\)::after/);
});

test('user message wrapping does not render template whitespace', () => {
	expect(styles).toMatch(/\.user-message p\s*\{[^}]*white-space: pre-wrap;/s);
});

test('transcript messages expose copy, edit, and session fork actions', () => {
	expect(page).toContain("import { Copy, GitFork, Pencil } from 'lucide-svelte'");
	expect(page).toContain('aria-label="Copy message"');
	expect(page).toContain('aria-label="Edit and resend message"');
	expect(page).toContain('aria-label="Fork session"');
	expect(page).toContain('<Pencil size={14}');
	expect(page).toContain('<Copy size={14}');
	expect(page).toContain('<GitFork size={14}');
	expect(page).toContain('navigator.clipboard.writeText(message.text)');
	expect(styles).toMatch(/\.message-actions\s*\{[^}]*display: flex;/s);
	expect(styles).toMatch(
		/@media \(max-width: 700px\)[\s\S]*\.message-actions button[\s\S]*min-height: 44px;/s
	);
});

test('interface icons use lucide instead of handwritten SVGs and glyphs', () => {
	expect(page).not.toContain('<svg');
	for (const icon of [
		'MessageSquare',
		'SlidersHorizontal',
		'CalendarDays',
		'Grid2X2',
		'Code2',
		'UserRound',
		'FileText',
		'Plus',
		'X',
		'Ellipsis',
		'RefreshCw',
		'Send'
	]) {
		expect(page).toContain(`<${icon}`);
	}
	expect(page).not.toContain('<span class="folder-icon"');
	expect(page).not.toContain('class="queue-handle" aria-hidden="true">⠿');
});

test('e2e project fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
