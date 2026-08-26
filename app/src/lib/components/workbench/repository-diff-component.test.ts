import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(import.meta.dir);

test('repository panels expose an accessible bounded diff review child', () => {
	const panel = readFileSync(join(directory, 'RepositoryPanels.svelte'), 'utf8');
	const review = readFileSync(join(directory, 'RepositoryDiff.svelte'), 'utf8');

	expect(panel).toContain("import RepositoryDiff from './RepositoryDiff.svelte'");
	expect(panel).toContain('<RepositoryDiff');
	expect(review).toContain('aria-label="Diff scope"');
	expect(review).toContain('aria-label="Changed file"');
	expect(review).toContain('aria-label="Previous hunk"');
	expect(review).toContain('aria-label="Next hunk"');
	expect(review).toContain('Copy selected lines');
	expect(review).toContain('Diff output was limited to');
	expect(review).toContain('Untracked files are not available in Git diff:');
	expect(review).toContain('{#each result.untrackedPaths as path}');
	expect(review).toContain('Additional untracked paths were omitted');
	expect(review).toContain('max-[700px]:min-h-11');
});
