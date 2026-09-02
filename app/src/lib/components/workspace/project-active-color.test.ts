import { expect, test } from 'bun:test';

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test('the selected Project uses its color or the app primary color', async () => {
	const rail = await read('./ProjectRail.svelte');
	const sessions = await read('./ContextPanel.svelte');
	const styles = await read('../../../styles/project-browser.css');

	expect(rail).toContain("import { projectColorForeground } from '$lib/project-color';");
	expect(rail).toContain("--active-project-color: ${project.color ?? 'var(--primary)'}");
	expect(rail).toContain(
		"--active-project-foreground: ${project.color ? projectColorForeground(project.color) : 'var(--primary-foreground)'}"
	);
	expect(styles).toContain('[data-project-id] .project-select.active');
	expect(styles).not.toContain('.project-row .project-select.active');
	expect(styles).toContain('background: var(--active-project-color);');
	expect(styles).toContain('color: var(--active-project-foreground);');
	expect(styles).toContain(
		'.project-select.active :is(\n\t.project-icon-default,\n\t.project-name,\n\t.project-session-count,\n\t.project-running-count,\n\t.project-attention-count,\n\tsmall\n)'
	);
	expect(sessions).toContain("import { projectColorForeground } from '$lib/project-color';");
	expect(sessions).toContain("--active-project-color: ${selectedProject?.color ?? 'var(--primary)'}");
	expect(styles).toContain('.session-select.active');
	expect(styles).toContain(
		'.session-select.active :is(.session-row-title, .session-row-copy, .busy-timer, small, .session-indicator)'
	);
});
