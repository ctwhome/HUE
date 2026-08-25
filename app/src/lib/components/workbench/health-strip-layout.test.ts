import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('desktop health status occupies a shell row instead of covering panels', () => {
	const healthStrip = read('./HealthStrip.svelte');
	const projectRail = read('../workspace/ProjectRail.svelte');
	const contextPanel = read('../workspace/ContextPanel.svelte');

	expect(healthStrip).not.toContain('project-status-bar absolute');
	expect(healthStrip).toContain('grid-template-rows: minmax(0, 1fr) auto');
	expect(healthStrip).toContain('grid-column: 1 / -1');
	expect(healthStrip).toContain('grid-row: 2');
	expect(projectRail).toContain('project-rail flex min-h-0');
	expect(contextPanel).toContain('context-panel flex min-h-0');
});
