import { expect, test } from 'bun:test';

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test('Chats shows its non-archived standalone Session count unless it is zero', async () => {
	const workspace = await read('../Workspace.svelte');
	const projectRail = await read('./ProjectRail.svelte');
	expect(workspace).toContain('{chatSessionCount}');
	expect(projectRail).toContain('{#if chatSessionCount}<span');
	expect(projectRail).toContain('aria-label={`${chatSessionCount} non-archived Chats`}');
});

test('Cron tasks appears beside Chats with its schedule-backed Session count', async () => {
	const workspace = await read('../Workspace.svelte');
	const projectRail = await read('./ProjectRail.svelte');
	expect(workspace).toContain(
		'cronSessionCount={cronSessionCount + navigation.externalCronJobs.length}'
	);
	expect(projectRail).toContain('>Cron tasks</span>');
	expect(projectRail).toContain('aria-label={`${cronSessionCount} cron tasks`}');
});
