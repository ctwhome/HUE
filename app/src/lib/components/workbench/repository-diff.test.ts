import { expect, test } from 'bun:test';
import {
	boundedDiffLineRange,
	fileDiffData,
	parseUnifiedDiff,
	repositoryDiffUrl
} from './repository-diff';

const diff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
-old
+new
+added
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+second
`;

test('parses changed files, hunks, and accessible line numbers from a unified diff', () => {
	const files = parseUnifiedDiff(diff);

	expect(files.map(({ path }) => path)).toEqual(['src/a.ts', 'src/b.ts']);
	expect(files[0].hunks).toHaveLength(1);
	expect(files[0].hunks[0].lines).toEqual([
		expect.objectContaining({ kind: 'context', oldLine: 1, newLine: 1, text: 'keep' }),
		expect.objectContaining({ kind: 'deletion', oldLine: 2, newLine: null, text: 'old' }),
		expect.objectContaining({ kind: 'addition', oldLine: null, newLine: 2, text: 'new' }),
		expect.objectContaining({ kind: 'addition', oldLine: null, newLine: 3, text: 'added' })
	]);
});

test('bounds a selected diff line range and reports when it was clipped', () => {
	const lines = Array.from({ length: 250 }, (_, index) => `+line ${index + 1}`);

	expect(boundedDiffLineRange(lines, 20, 22)).toEqual({
		text: '+line 21\n+line 22\n+line 23',
		clipped: false
	});
	const bounded = boundedDiffLineRange(lines, 0, 249);
	expect(bounded.text.split('\n')).toHaveLength(200);
	expect(bounded.clipped).toBe(true);
});

test('builds split-view data for one tracked file', () => {
	expect(fileDiffData(diff, 'src/a.ts', '', false)).toEqual({
		oldFile: { fileName: 'src/a.ts' },
		newFile: { fileName: 'src/a.ts' },
		hunks: ['--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+added']
	});
});

test('builds an all-added split view for an untracked text file', () => {
	expect(fileDiffData('', 'src/new.ts', 'first\nsecond', true)).toEqual({
		oldFile: { fileName: 'src/new.ts' },
		newFile: { fileName: 'src/new.ts' },
		hunks: ['--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+first\n+second']
	});
});

test('builds an all-deleted split view without current file content', () => {
	const deleted = `diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-first
-second
`;

	expect(fileDiffData(deleted, 'src/deleted.ts', '', false)).toEqual({
		oldFile: { fileName: 'src/deleted.ts' },
		newFile: { fileName: 'src/deleted.ts' },
		hunks: ['--- a/src/deleted.ts\n+++ b/src/deleted.ts\n@@ -1,2 +0,0 @@\n-first\n-second']
	});
});

test('uses the filtered diff when Git quotes the selected path', () => {
	const quoted = diff
		.slice(0, diff.indexOf('diff --git a/src/b.ts'))
		.replaceAll('src/a.ts', '"src/na\\303\\257ve.ts"');

	expect(fileDiffData(quoted, 'src/naïve.ts', '', false).hunks).toHaveLength(1);
});

test('builds a file-filtered repository diff URL', () => {
	expect(
		repositoryDiffUrl('project 1', {
			scope: 'staged',
			repository: 'packages/app',
			file: 'src/a file.ts',
			currentFile: true
		})
	).toBe(
		'/api/projects/project%201/repository?view=diff&scope=staged&repository=packages%2Fapp&file=src%2Fa+file.ts'
	);
});
