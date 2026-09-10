import { describe, expect, it, spyOn } from 'bun:test';
import * as serviceModule from '$lib/server/services';
import { _scheduleAction, GET, POST } from './+server';

describe('Hermes admin API boundary', () => {
	for (const [view, path] of [
		['logs', '/api/logs?file=errors&lines=100'],
		['update', '/api/hermes/update/check']
	]) {
		it(`allows the separate ${view} view and requests only its upstream resource`, async () => {
			const requests: string[] = [];
			const stub = spyOn(serviceModule, 'services').mockReturnValue({
				admin: {
					async json(path: string) {
						requests.push(path);
						return { ready: true };
					}
				}
			} as never);
			try {
				const response = await GET({
					url: new URL(`http://localhost/api/hermes/admin?view=${view}`)
				} as never);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ [view!]: { ready: true } });
				expect(requests).toEqual([path!]);
			} finally {
				stub.mockRestore();
			}
		});
	}
	const event = (request: Request, clientAddress = '127.0.0.1') => ({
		request,
		url: new URL(request.url),
		getClientAddress: () => clientAddress
	});

	it('rejects unknown views before contacting Hermes', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/hermes/admin?view=secrets')
		} as never);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Unknown Hermes administration view' });
	});

	it('rejects unknown mutations and malformed input', async () => {
		const unknownRequest = new Request('http://localhost/api/hermes/admin', {
			method: 'POST',
			headers: { host: 'localhost' },
			body: JSON.stringify({ action: 'config.raw.write', input: {} })
		});
		const unknown = await POST(event(unknownRequest) as never);
		expect(unknown.status).toBe(400);
		expect(await unknown.json()).toEqual({ error: 'Unknown Hermes administration action' });

		const malformedRequest = new Request('http://localhost/api/hermes/admin', {
			method: 'POST',
			headers: { host: 'localhost' },
			body: JSON.stringify({ action: 'skill.create', input: [] })
		});
		const malformed = await POST(event(malformedRequest) as never);
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toEqual({ error: 'input is required' });
	});

	it('requires explicit runtime restart and reconnect confirmations', async () => {
		for (const action of ['runtime.restart-admin', 'runtime.reconnect-acp']) {
			const request = new Request('http://localhost/api/hermes/admin', {
				method: 'POST',
				headers: { host: 'localhost' },
				body: JSON.stringify({ action, input: {} })
			});
			const response = await POST(event(request) as never);
			expect(response.status).toBe(400);
			expect((await response.json()).error).toContain('confirm');
		}
	});

	it('rejects remote, rebound, and cross-origin mutations before parsing JSON', async () => {
		for (const [url, headers, address] of [
			['http://localhost/api/hermes/admin', { host: 'localhost' }, '203.0.113.10'],
			[
				'http://attacker.example/api/hermes/admin',
				{ host: 'attacker.example', origin: 'http://attacker.example' },
				'127.0.0.1'
			],
			[
				'http://localhost/api/hermes/admin',
				{ host: 'localhost', origin: 'https://attacker.example' },
				'127.0.0.1'
			]
		] as const) {
			const request = new Request(url, { method: 'POST', headers, body: '{not-json' });
			const response = await POST(event(request, address) as never);
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: 'API access is limited to this device' });
		}
	});

	it('delegates schedule actions to the HUE-owned ScheduleService', async () => {
		const calls: unknown[][] = [];
		const schedules = {
			create: async (input: unknown) => (calls.push(['create', input]), { id: 'new' }),
			update: (id: string, input: unknown) => (calls.push(['update', id, input]), { id }),
			pause: (id: string) => (calls.push(['pause', id]), { id }),
			resume: (id: string) => (calls.push(['resume', id]), { id }),
			get: (id: string) => ({ id }),
			detail: () => {
				throw new Error('Run now must not hydrate history');
			},
			runNow: (id: string, runId: string) => (calls.push(['run', id, runId]), { status: 'queued' }),
			delete: (id: string) => (calls.push(['delete', id]), { deleted: { id } })
		};

		await _scheduleAction(schedules as never, 'schedule.create', {
			name: 'Daily',
			prompt: 'Review',
			cron: '0 9 * * *',
			timezone: 'Europe/Amsterdam'
		});
		await _scheduleAction(schedules as never, 'schedule.run', { id: 'daily', runId: 'client-1' });

		expect(calls).toEqual([
			[
				'create',
				{
					name: 'Daily',
					prompt: 'Review',
					cron: '0 9 * * *',
					timezone: 'Europe/Amsterdam'
				}
			],
			['run', 'daily', 'client-1']
		]);
	});

	it('returns accepted run status and lightweight schedule metadata without history', async () => {
		const calls: string[] = [];
		const target = {
			id: 'daily',
			name: 'Daily',
			sessionId: 's-1',
			nextRunAt: '2026-01-02T00:00:00Z',
			prompt: 'Review',
			cron: '0 0 * * *',
			timezone: 'UTC',
			enabled: true,
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z'
		};
		const result = await _scheduleAction(
			{
				detail: () => {
					throw new Error('Full history unavailable');
				},
				get: () => target,
				runNow: async () => {
					calls.push('accepted');
					return { status: 'queued', duplicate: false };
				}
			} as never,
			'schedule.run',
			{ id: 'daily', runId: 'run-1' }
		);
		expect(calls).toEqual(['accepted']);
		expect(result).toEqual({ target, delivery: { status: 'queued', duplicate: false } });
	});
});
