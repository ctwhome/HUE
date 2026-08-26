import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the active Project toggles Sessions without a collapsed Sessions column', () => {
	const workspace = read('../Workspace.svelte');
	const projectRail = read('./ProjectRail.svelte');
	const styles = `${read('../../../styles/workspace-forms.css')}\n${read('../../../styles/responsive.css')}`;

	expect(workspace).toContain('function chooseProjectFromRail(project: Project | null)');
	expect(workspace).toContain('onchoose={chooseProjectFromRail}');
	expect(workspace).not.toContain('class="panel-reopen-tab sessions"');
	expect(projectRail).toContain("aria-controls={selectedProject?.id === project.id ? 'session-drawer' : undefined}");
	expect(projectRail).toContain('aria-expanded={selectedProject?.id === project.id ? sessionsOpen : undefined}');
	expect(styles).toContain('.workspace.sessions-panel-closed > .session-workspace');
	expect(styles).not.toContain('40px minmax(0, 1fr)');
});
