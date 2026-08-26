import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the primary session context usage appears in the session header', () => {
	const header = read('./SessionHeader.svelte');
	const workspace = read('../Workspace.svelte');

	expect(header).toContain('context tokens used');
	expect(workspace).toContain('contextPercent={runtimeState.contextPercent}');
	expect(workspace).toContain('showContextUsage={false}');
});
