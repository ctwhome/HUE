import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('compact project tools use one navigation row', () => {
	const workbench = readFileSync(join(import.meta.dir, '../ProjectWorkbench.svelte'), 'utf8');

	expect(workbench.match(/compact-workbench-tabs/g)).toHaveLength(1);
	expect(workbench).toContain('class:compact-workbench-tabs={compact}');
	expect(workbench).not.toContain('{#if compact}<nav class="compact-workbench-tabs"');
	expect(workbench).toContain("onclick={() => openDevelopView('browser')}");
	expect(workbench).toContain("onclick={() => openDevelopView('terminal')}");
	expect(workbench).toContain("onclick={() => openDevelopView('git')}");
	expect(workbench).toContain('aria-pressed={view === \'files\'}');
});

test('project tools use the navigation surface instead of the chat background', () => {
	const styles = readFileSync(join(import.meta.dir, '../../../styles/project-browser.css'), 'utf8');

	expect(styles).toContain('--project-tool-surface: var(--navigation-surface)');
	expect(styles).toContain('background: var(--project-tool-surface)');
});
