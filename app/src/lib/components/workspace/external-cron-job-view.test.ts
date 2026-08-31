import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const view = readFileSync(join(import.meta.dir, 'ExternalCronJobView.svelte'), 'utf8');

test('compact run selector includes completed, failed, and unknown runs', () => {
	const selector = view.match(/<label[\s\S]*?min-\[1200px\]:hidden[\s\S]*?<\/label>/)?.[0] ?? '';
	expect(selector).toContain('{#each runs as run (run.sessionId)}');
	expect(selector).toContain('{run.status}');
	expect(selector).not.toContain('completedRuns');
});

test('run and transcript fetch errors are visible on the Runs tab', () => {
	expect(view).toMatch(
		/aria-label="Cron job content">[\s\S]*?\{#if error\}[\s\S]*?role="alert"[\s\S]*?\{error\}[\s\S]*?\{\/if\}[\s\S]*?\{#if tab === 'runs'\}/
	);
});

test('detail errors survive automatic run opening and can be retried from Settings', () => {
	const openRun = view.match(/async function openRun[\s\S]*?\n\t}/)?.[0] ?? '';
	const settings = view.slice(view.indexOf('{:else}<div class="mx-auto grid max-w-3xl'));

	expect(view).toContain("let detailError = $state('')");
	expect(view).toMatch(/async function loadDetail[\s\S]*?detailError = cause/);
	expect(openRun).not.toContain('detailError');
	expect(settings).toMatch(
		/\{#if detailError\}[\s\S]*?role="alert"[\s\S]*?\{detailError\}[\s\S]*?onclick=[\s\S]*?loadDetail[\s\S]*?Retry/
	);
});

test('desktop run history still lists every status', () => {
	const history =
		view.match(/<section[\s\S]*?aria-label="Cron run history"[\s\S]*?<\/section>/)?.[0] ?? '';
	expect(history).toContain('hidden');
	expect(history).toContain('min-[1200px]:grid');
	expect(history).toContain('{#each runs as run (run.sessionId)}');
	expect(history).toContain("run.status === 'failed'");
	expect(history).toContain('<CircleHelp');
});
