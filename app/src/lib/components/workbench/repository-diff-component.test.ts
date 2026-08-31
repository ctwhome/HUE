import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(import.meta.dir);

test('repository panels keep the Git pane focused on staging and committing', () => {
	const panel = readFileSync(join(directory, 'RepositoryPanels.svelte'), 'utf8');

	expect(panel).not.toContain("import RepositoryDiff from './RepositoryDiff.svelte'");
	expect(panel).not.toContain('<RepositoryDiff');
	expect(panel).toContain('aria-label="Staged changes"');
	expect(panel).toContain('aria-label="Changes"');
	expect(panel).toContain('Commit &amp; push');
	expect(panel).not.toContain('<nav class="repository-links');
	const headerActions = panel.slice(
		panel.indexOf('<div class="git-header-actions'),
		panel.indexOf('</div>', panel.indexOf('<div class="git-header-actions'))
	);
	expect(headerActions).toContain('repositoryLinks().slice(0, 1)');
});

test('commit drafts can disable reasoning independently of the selected model', () => {
	const panel = readFileSync(join(directory, 'RepositoryPanels.svelte'), 'utf8');

	expect(panel).toContain('ariaLabel="Commit message reasoning"');
	expect(panel).toContain("{ value: 'none', name: 'None' }");
	expect(panel).toContain("localStorage.setItem('hue:commit-message-reasoning'");
	expect(panel).toContain('reasoning: commitReasoning');
});

test('changed-file clicks request split diff mode in the Files pane', () => {
	const panel = readFileSync(join(directory, 'RepositoryPanels.svelte'), 'utf8');
	const files = readFileSync(join(directory, 'FilesPanel.svelte'), 'utf8');
	const preview = readFileSync(join(directory, 'FilePreview.svelte'), 'utf8');
	const viewer = readFileSync(join(directory, 'FileDiffViewer.svelte'), 'utf8');
	const workbench = readFileSync(join(directory, '../ProjectWorkbench.svelte'), 'utf8');

	expect(panel).toContain("openValidated(change, 'staged')");
	expect(panel).toContain("openValidated(change, 'unstaged')");
	expect(panel).toContain('path: change.fileUrl ?? change.diffUrl');
	expect(panel).toContain('currentFile: Boolean(change.fileUrl)');
	expect(files).toContain('repositoryDiffUrl(projectId, selection.diff)');
	expect(files).toContain('selection.diff?.currentFile !== false');
	expect(files).toContain('Diff unavailable:');
	expect(files).toContain('signal: request.controller.signal');
	expect(preview).toContain("import('./FileDiffViewer.svelte')");
	expect(preview).toContain('Boolean(preview || diffData)');
	expect(viewer).toContain("from '@git-diff-view/svelte'");
	expect(viewer).toContain('narrow ? DiffModeEnum.Unified : DiffModeEnum.Split');
	expect(workbench).toContain('document.activeElement instanceof HTMLElement');
	expect(workbench).toContain("querySelector<HTMLElement>('.file-preview')?.focus()");
});
