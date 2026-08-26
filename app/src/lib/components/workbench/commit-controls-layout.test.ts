import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RepositoryPanels.svelte', import.meta.url), 'utf8');
const github = readFileSync(new URL('./GitHubPanels.svelte', import.meta.url), 'utf8');

test('commit generation lives in the message input and shares the model picker', () => {
	expect(source).toContain('class="commit-message-field relative"');
	expect(source).toContain('class="h-8 pr-10 text-xs');
	expect(source).toContain('aria-label="Generate commit message with Hermes"');
	expect(source).toContain("import ModelPicker from '../ModelPicker.svelte'");
	expect(source).toContain('ariaLabel="Commit message model"');
	expect(source).toContain('ellipsis={true}');
	expect(source).not.toContain('commitModelDialog');
	expect(source.indexOf('aria-label="Git worktrees"')).toBeLessThan(source.indexOf('<GitHubPanels'));
});

test('Git, Worktrees, and GitHub headers toggle their full panels', () => {
	expect(source).toContain('aria-expanded={gitOpen}');
	expect(source).toContain('onclick={(event) => togglePanelFromHeader(event, toggleGit)}');
	expect(source).toContain('aria-expanded={worktreesOpen}');
	expect(github).toContain('aria-expanded={open}');
	expect(github).toContain('onclick={(event) => toggleFromHeader(event)}');
});
