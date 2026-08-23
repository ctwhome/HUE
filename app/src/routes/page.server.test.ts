import { beforeEach, expect, mock, test } from 'bun:test';
import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let failure: Error | null = null;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	loadProjectViews: async () => {
		if (failure) throw failure;
		return {
			projects: [{ id: 'p_1', name: 'HUE', primaryPath: '/work/hue', folders: [] }],
			reconciliationIssues: []
		};
	}
}));

beforeEach(() => (failure = null));

test('loads authoritative Hermes Project views', async () => {
	const { load } = await import('./+page.server');

	expect(await load({} as never)).toEqual({
		projects: [expect.objectContaining({ id: 'p_1' })],
		projectsCapability: 'available',
		projectsError: '',
		reconciliationIssues: []
	});
});

test('renders old-runtime capability guidance without local Project rows', async () => {
	failure = new HermesProjectsCapabilityError();
	const { load } = await import('./+page.server');

	expect(await load({} as never)).toEqual({
		projects: [],
		projectsCapability: 'unavailable',
		projectsError: expect.stringContaining('Upgrade Hermes'),
		reconciliationIssues: []
	});
});

test('renders Hermes outage without stale local Project authority', async () => {
	failure = new Error('Hermes administration unavailable');
	const { load } = await import('./+page.server');

	expect(await load({} as never)).toEqual({
		projects: [],
		projectsCapability: 'outage',
		projectsError: 'Hermes administration unavailable',
		reconciliationIssues: []
	});
});
