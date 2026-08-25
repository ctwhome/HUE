import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('desktop navigation toggles the Projects and Sessions panels independently', () => {
	const workspace = read('../Workspace.svelte');
	const navigation = read('../GlobalNavigation.svelte');
	const styles = `${read('../../../styles/workspace-forms.css')}\n${read('../../../styles/responsive.css')}`;

	expect(navigation).toContain("panel: 'projects' | 'sessions'");
	expect(navigation).toContain("label={`${projectsOpen ? 'Hide' : 'Show'} Projects panel`}");
	expect(navigation).toContain("label={`${sessionsOpen ? 'Hide' : 'Show'} Sessions panel`}");
	expect(workspace).toContain('class:projects-panel-closed={!projectsPanelOpen}');
	expect(workspace).toContain('class:sessions-panel-closed={!sessionsPanelOpen}');
	expect(styles).toContain('.workspace.projects-panel-closed');
	expect(styles).toContain('.workspace.sessions-panel-closed');
});
