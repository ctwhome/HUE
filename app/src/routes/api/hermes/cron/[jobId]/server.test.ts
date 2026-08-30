import { beforeEach, expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const calls: Array<[string, RequestInit | undefined]> = [];
mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	services: () => ({
		admin: {
			async json(path: string, init?: RequestInit) {
				calls.push([path, init]);
				return {
					id: 'job-1',
					name: 'Daily review',
					prompt: 'Review',
					schedule: { kind: 'cron', expr: '0 9 * * *' },
					deliver: 'local',
					enabled: true,
					state: 'scheduled'
				};
			}
		}
	})
}));

const { GET, PUT, DELETE } = await import('./+server');
const event = (request: Request) => ({
	params: { jobId: 'job-1' },
	request,
	url: new URL(request.url),
	getClientAddress: () => '127.0.0.1'
});

beforeEach(() => calls.splice(0));

test('loads and updates one profile-scoped Hermes cron job', async () => {
	const getRequest = new Request('http://localhost/api/hermes/cron/job-1?profile=default');
	const loaded = await GET(event(getRequest) as never);
	expect(loaded.status).toBe(200);
	expect((await loaded.json()).job).toMatchObject({ jobId: 'job-1', prompt: 'Review' });

	const putRequest = new Request('http://localhost/api/hermes/cron/job-1?profile=default', {
		method: 'PUT',
		headers: { host: 'localhost', 'content-type': 'application/json' },
		body: JSON.stringify({
			updates: {
				name: 'Morning review',
				prompt: 'Review',
				schedule: '30 8 * * *',
				deliver: 'local',
				model: '',
				provider: ''
			}
		})
	});
	const updated = await PUT(event(putRequest) as never);
	expect(updated.status).toBe(200);
	expect(calls.map(([path]) => path)).toEqual([
		'/api/cron/jobs/job-1?profile=default',
		'/api/cron/jobs/job-1?profile=default'
	]);
	expect(calls[1]?.[1]?.method).toBe('PUT');
});

test('requires device access and exact job confirmation before deletion', async () => {
	const unconfirmed = new Request('http://localhost/api/hermes/cron/job-1?profile=default', {
		method: 'DELETE',
		headers: { host: 'localhost' }
	});
	const rejected = await DELETE(event(unconfirmed) as never);
	expect(rejected.status).toBe(400);
	expect(calls).toHaveLength(0);

	const confirmed = new Request(
		'http://localhost/api/hermes/cron/job-1?profile=default&confirm=job-1',
		{ method: 'DELETE', headers: { host: 'localhost' } }
	);
	const removed = await DELETE(event(confirmed) as never);
	expect(removed.status).toBe(200);
	expect(calls[0]?.[1]?.method).toBe('DELETE');
});
