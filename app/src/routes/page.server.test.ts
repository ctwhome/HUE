import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let reconcile: () => Promise<unknown>;
mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	services: () => ({
		store: {
			countSessions: (_project: null, scope: string) => (scope === 'scheduled' ? 2 : 4),
			getSessionIndicatorCounts: () => ({ running: 1, attention: 0, unread: 2 })
		}
	}),
	loadProjectViews: () => reconcile()
}));

test('renders reconciled Projects when the streamed load settles', () => {
	const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	expect(page).toContain('{#await data.projectReconciliation}');
	expect(page).toContain('{:then reconciled}');
	expect(page).toContain('projects={reconciled.projects}');
});

test('returns local counts before Project reconciliation settles', async () => {
	let finish!: (value: unknown) => void;
	reconcile = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const { load } = await import('./+page.server');
	const pending = Promise.resolve(load({} as never));
	const result = await Promise.race([pending, Bun.sleep(50).then(() => null)]);
	finish({ projects: [{ id: 'p_1' }], reconciliationIssues: [] });
	expect(result).not.toBeNull();
	expect(result).toMatchObject({
		projects: [],
		projectsLoading: true,
		chatSessionCount: 4,
		cronSessionCount: 2,
		chatIndicators: { running: 1, attention: 0, unread: 2 }
	});
	expect(await result!.projectReconciliation).toMatchObject({
		projects: [{ id: 'p_1' }],
		projectsCapability: 'available',
		projectsLoading: false
	});
});

test('retains local counts during outage or missing Project capability', async () => {
	const { load } = await import('./+page.server');
	for (const failure of [new Error('Hermes offline'), new HermesProjectsCapabilityError()]) {
		reconcile = async () => {
			throw failure;
		};
		const result = await load({} as never);
		expect(result).toMatchObject({ chatSessionCount: 4, cronSessionCount: 2 });
		expect(await result!.projectReconciliation).toMatchObject({
			projects: [],
			projectsCapability:
				failure instanceof HermesProjectsCapabilityError ? 'unavailable' : 'outage',
			projectsError: failure.message
		});
	}
});
