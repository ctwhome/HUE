import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('compact project tools use one navigation row', () => {
	const workbench = readFileSync(join(import.meta.dir, '../ProjectWorkbench.svelte'), 'utf8');

	expect(workbench.match(/compact-workbench-tabs/g)).toHaveLength(1);
	expect(workbench).toContain('class:compact-workbench-tabs={compact}');
	expect(workbench).not.toContain('{#if compact}<nav class="compact-workbench-tabs"');
	expect(workbench).toContain("onclick={() => openDevelopView('browser')}");
	expect(workbench).toContain("onclick={() => openDevelopView('excalidraw')}");
	expect(workbench).toContain("onclick={() => openDevelopView('terminal')}");
	expect(workbench).toContain("onclick={() => openDevelopView('git')}");
	expect(workbench).toContain("aria-pressed={view === 'files'}");
});

test('Excalidraw is independent from the browser panel', () => {
	const browser = readFileSync(join(import.meta.dir, 'BrowserPanel.svelte'), 'utf8');
	const workspace = readFileSync(join(import.meta.dir, '../Workspace.svelte'), 'utf8');

	expect(browser).not.toContain('ExcalidrawPanel');
	expect(workspace).toContain('<ProjectExcalidrawDock');
});

test('project tool panel gutters use the selected project color', () => {
	const styles = readFileSync(join(import.meta.dir, '../../../styles/project-browser.css'), 'utf8');

	expect(styles).toContain('--project-tool-border-surface: var(--project-shell-color)');
	expect(styles).toContain('--project-tool-surface: var(--navigation-surface)');
	expect(styles).toContain('background: var(--project-tool-border-surface)');
	expect(styles).toContain('background: var(--project-tool-surface)');
});

test('Git panel resizers occupy one panel gap', () => {
	const styles = readFileSync(join(import.meta.dir, '../../../styles/project-browser.css'), 'utf8');

	expect(styles).toContain('gap: var(--panel-gap)');
	expect(styles).toContain('min-height: var(--panel-gap)');
	expect(styles).toContain('margin: calc(-1 * var(--panel-gap)) 0');
});
