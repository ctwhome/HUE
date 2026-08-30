import { expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

let read = false;
const run = { sessionId: 'cron_job-1_20260830_090000' };
mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({
		admin: {
			loadTranscript: async (sessionId: string, profile: string) => [
				{ role: 'assistant', text: `${profile}:${sessionId}` }
			]
		},
		store: {
			getExternalCronRun: () => run,
			markExternalCronRunRead: () => (read = true)
		}
	})
}));

const { GET, PUT } = await import('./+server');
const event = (request: Request) => ({
	params: { jobId: 'job-1', sessionId: run.sessionId },
	request,
	url: new URL(request.url),
	getClientAddress: () => '127.0.0.1'
});

test('loads the real profile-scoped transcript and marks the projected run read', async () => {
	const getRequest = new Request(
		`http://localhost/api/hermes/cron/job-1/runs/${run.sessionId}?profile=default`
	);
	const response = await GET(event(getRequest) as never);
	expect(response.status).toBe(200);
	expect((await response.json()).messages).toEqual([
		{ role: 'assistant', text: `default:${run.sessionId}` }
	]);

	const putRequest = new Request(getRequest.url, {
		method: 'PUT',
		headers: { host: 'localhost' }
	});
	expect((await PUT(event(putRequest) as never)).status).toBe(200);
	expect(read).toBe(true);
});
