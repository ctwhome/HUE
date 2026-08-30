import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let refreshed = '';
mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({
		externalCron: {
			async refreshJob(profile: string, jobId: string) {
				refreshed = `${profile}:${jobId}`;
			}
		},
		store: {
			listExternalCronRuns: () => [{ sessionId: 'cron_job-1_20260830_090000' }]
		}
	})
}));

const { GET } = await import('./+server');

test('refreshes and lists profile-scoped Hermes cron runs', async () => {
	const request = new Request('http://localhost/api/hermes/cron/job-1/runs?profile=default');
	const response = await GET({
		params: { jobId: 'job-1' },
		request,
		url: new URL(request.url)
	} as never);
	expect(response.status).toBe(200);
	expect(refreshed).toBe('default:job-1');
	expect((await response.json()).runs).toEqual([{ sessionId: 'cron_job-1_20260830_090000' }]);
});
