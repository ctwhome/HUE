import { expect, test } from 'bun:test';

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test('Chats shows its non-archived standalone Session count unless it is zero', async () => {
	const workspace = await read('../Workspace.svelte');
	const projectRail = await read('./ProjectRail.svelte');
	expect(workspace).toContain('chatSessionCount={chatSessionCount}');
	expect(projectRail).toContain('{#if chatSessionCount}<span');
	expect(projectRail).toContain('aria-label={`${chatSessionCount} non-archived Chats`}');
});
