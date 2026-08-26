import { expect, test } from 'bun:test';
import { boundedDiffLineRange, parseUnifiedDiff } from './repository-diff';

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

	expect(boundedDiffLineRange(lines, 20, 22)).toEqual({ text: '+line 21\n+line 22\n+line 23', clipped: false });
	const bounded = boundedDiffLineRange(lines, 0, 249);
	expect(bounded.text.split('\n')).toHaveLength(200);
	expect(bounded.clipped).toBe(true);
});
