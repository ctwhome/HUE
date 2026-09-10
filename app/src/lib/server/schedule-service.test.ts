import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleService } from './schedule-service';
import { HUEStore } from './store';

describe('ScheduleService', () => {
	it('queries only the earliest non-backed-off timestamp and wakes for retry expiry', async () => {
		let now = new Date('2026-01-01T01:00Z');
		const exclusions: string[][] = [];
		let nextRunAt: string | null = '2026-01-01T01:00:10Z';
		let due = true;
		const store = {
			listSchedules: () => {
				throw new Error('Must not hydrate all schedules');
			},
			listDueSchedules: () =>
				due
					? [{ id: 'bad', cron: '0 * * * *', timezone: 'UTC', nextRunAt: '2026-01-01T00:00Z' }]
					: [],
			acceptDueSchedule: () => {
				throw new Error('Unavailable');
			},
			getNextScheduleRunAt: (excludeIds: string[] = []) => {
				exclusions.push(excludeIds);
				return nextRunAt;
			}
		};
		const delays: number[] = [];
		let wake!: () => void;
		let armed!: () => void;
		const arm = () =>
			new Promise<void>((resolve) => {
				armed = resolve;
			});
		const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((
			callback: () => void,
			delay: number
		) => {
			wake = callback;
			delays.push(delay);
			armed();
			return 0;
		}) as typeof setTimeout);
		const log = spyOn(console, 'error').mockImplementation(() => undefined);
		let service!: ScheduleService;
		try {
			const ready = arm();
			service = new ScheduleService({
				store: store as never,
				root: () => '/tmp',
				now: () => now,
				runtime: { createSession: async (cwd) => ({ cwd, sessionId: 'unused' }) },
				dispatcher: { submit: () => undefined, submitAccepted: () => undefined }
			});
			await ready;
			expect(exclusions).toEqual([['bad']]);
			expect(delays).toEqual([10_000]);
			now = new Date('2026-01-01T01:00:10Z');
			nextRunAt = null;
			due = false;
			const retried = arm();
			wake();
			await retried;
			expect(delays).toEqual([10_000, 20_000]);
			now = new Date('2026-01-01T01:00:30Z');
			nextRunAt = '2026-01-01T02:00Z';
			const expired = arm();
			wake();
			await expired;
			expect(exclusions.at(-1)).toEqual([]);
			expect(delays.at(-1)).toBe(3_570_000);
		} finally {
			service?.close();
			timer.mockRestore();
			log.mockRestore();
		}
	});
	it('rearms failures with a positive delay without starting a real scheduler', async () => {
		for (const failure of ['accept', 'inventory', 'arm'] as const) {
			const store = new HUEStore(':memory:');
			store.upsertSession(null, { sessionId: 's-1', cwd: '/tmp' });
			store.createSchedule({
				id: 'a',
				sessionId: 's-1',
				name: 'A',
				prompt: 'A',
				cron: '0 * * * *',
				timezone: 'UTC',
				enabled: true,
				nextRunAt: '2026-01-01T00:00:00.000Z'
			});
			const fault = spyOn(
				store,
				failure === 'accept'
					? 'acceptDueSchedule'
					: failure === 'inventory'
						? 'listDueSchedules'
						: 'getNextScheduleRunAt'
			).mockImplementation(() => {
				throw new Error('Unavailable');
			});
			const log = spyOn(console, 'error').mockImplementation(() => undefined);
			const delays: number[] = [];
			let armed!: () => void;
			let service!: ScheduleService;
			const ready = new Promise<void>((resolve) => {
				armed = resolve;
			});
			const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((
				_callback: unknown,
				delay: number
			) => {
				delays.push(delay);
				armed();
				return 0;
			}) as typeof setTimeout);
			try {
				service = new ScheduleService({
					store,
					root: () => '/tmp',
					now: () => new Date('2026-01-01T01:00Z'),
					runtime: { createSession: async (cwd) => ({ cwd, sessionId: 'unused' }) },
					dispatcher: { submit: () => undefined, submitAccepted: () => undefined }
				});
				await ready;
				expect(delays).toEqual([30_000]);
			} finally {
				service?.close();
				timer.mockRestore();
				fault.mockRestore();
				log.mockRestore();
				store.close();
			}
		}
	});
	it('isolates failed jobs, backs off retries, and retains the original durable occurrence', async () => {
		const store = new HUEStore(':memory:');
		let now = new Date('2026-01-01T01:00Z');
		let sessions = 0;
		const service = new ScheduleService({
			store,
			root: () => '/tmp',
			now: () => now,
			startTimer: false,
			runtime: { createSession: async (cwd) => ({ cwd, sessionId: `s-${++sessions}` }) },
			dispatcher: { submit: () => undefined, submitAccepted: () => undefined }
		});
		const first = await service.create({
			name: 'A',
			prompt: 'A',
			cron: '0 * * * *',
			timezone: 'UTC'
		});
		const second = await service.create({
			name: 'B',
			prompt: 'B',
			cron: '0 * * * *',
			timezone: 'UTC'
		});
		const due = '2026-01-01T00:00:00.000Z';
		for (const schedule of [first, second]) store.updateSchedule(schedule.id, { nextRunAt: due });
		const accept = store.acceptDueSchedule.bind(store);
		let attempts = 0;
		const fault = spyOn(store, 'acceptDueSchedule').mockImplementation((...args) => {
			if (args[0] === first.id && ++attempts <= 2) throw new Error('Storage unavailable');
			return accept(...args);
		});
		const log = spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			await service.runDue();
			expect(store.listMessages(null, second.sessionId)).toHaveLength(1);
			expect(store.getSchedule(first.id)?.nextRunAt).toBe(due);
			await service.runDue();
			expect(attempts).toBe(1);
			now = new Date(now.getTime() + 30_000);
			await service.runDue();
			expect(attempts).toBe(2);
			await service.runDue();
			expect(attempts).toBe(2);
			now = new Date(now.getTime() + 30_000);
			await service.runDue();
			expect(store.listMessages(null, first.sessionId).map(({ id }) => id)).toEqual([
				`schedule:${first.id}:${due}`
			]);
		} finally {
			fault.mockRestore();
			log.mockRestore();
			service.close();
			store.close();
		}
	});
	it('rejects a valid but impossible cron before creating a Hermes Session', async () => {
		const store = new HUEStore(':memory:');
		let sessions = 0;
		const service = new ScheduleService({
			store,
			runtime: {
				createSession: async (cwd) => {
					sessions += 1;
					return { sessionId: 'orphan', cwd };
				}
			},
			dispatcher: { submit: () => undefined, submitAccepted: () => undefined },
			root: () => '/tmp',
			now: () => new Date('2026-01-01T00:00:00Z'),
			startTimer: false
		});

		await expect(
			service.create({ name: 'Impossible', prompt: 'Never', cron: '0 0 31 2 *', timezone: 'UTC' })
		).rejects.toThrow('no occurrence');
		expect(sessions).toBe(0);
		expect(store.listSchedules()).toEqual([]);
		store.close();
	});

	it('rejects an invalid time zone before creating a Hermes Session', async () => {
		const store = new HUEStore(':memory:');
		let sessions = 0;
		const service = new ScheduleService({
			store,
			runtime: {
				createSession: async (cwd) => {
					sessions += 1;
					return { sessionId: 'orphan', cwd };
				}
			},
			dispatcher: { submit: () => undefined, submitAccepted: () => undefined },
			root: () => '/tmp',
			now: () => new Date('2026-01-01T00:00:00Z'),
			startTimer: false
		});

		await expect(
			service.create({ name: 'Invalid', prompt: 'Never', cron: '0 8 * * *', timezone: 'Nope' })
		).rejects.toThrow('Invalid time zone');
		expect(sessions).toBe(0);
		service.close();
		store.close();
	});

	it('creates one projectless Session and dispatches manual runs without moving the next occurrence', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-schedules-'));
		const store = new HUEStore(':memory:');
		const submitted: Array<{ id: string; sessionId: string; text: string }> = [];
		const service = new ScheduleService({
			store,
			runtime: { createSession: async (cwd) => ({ sessionId: 'schedule-session', cwd }) },
			dispatcher: {
				submit: (envelope) => {
					const accepted = store.acceptMessage(envelope);
					submitted.push(envelope);
					return accepted;
				},
				submitAccepted: (envelope) => submitted.push(envelope)
			},
			root: () => root,
			now: () => new Date('2026-08-28T08:00:00Z'),
			startTimer: false
		});

		const schedule = await service.create({
			name: 'Daily review',
			prompt: 'Review HUE',
			cron: '0 9 * * *',
			timezone: 'UTC'
		});
		const next = schedule.nextRunAt;
		await service.runNow(schedule.id, 'client-run-1');

		expect(service.detail(schedule.id).nextRunAt).toBe(next);
		expect(service.detail(schedule.id).timezone).toBe('UTC');
		expect(store.getSession(null, 'schedule-session')).toMatchObject({
			title: 'Daily review',
			folder: 'Schedules'
		});
		expect(store.getMessage('client-run-1')?.status).toBe('queued');
		expect(submitted).toEqual([
			expect.objectContaining({
				id: 'client-run-1',
				sessionId: 'schedule-session',
				text: 'Review HUE'
			})
		]);
		service.close();
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	it('coalesces overdue occurrences durably and serializes dispatch through the Session lock', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-schedules-due-'));
		mkdirSync(root, { recursive: true });
		const store = new HUEStore(':memory:');
		const calls: string[] = [];
		const service = new ScheduleService({
			store,
			runtime: { createSession: async (cwd) => ({ sessionId: 'due-session', cwd }) },
			dispatcher: {
				submit: (envelope) => store.acceptMessage(envelope),
				submitAccepted: (envelope) => calls.push(`submit:${envelope.id}`)
			},
			root: () => root,
			now: () => new Date('2026-08-28T12:30:00Z'),
			startTimer: false
		});
		const schedule = await service.create({
			name: 'Hourly',
			prompt: 'Run',
			cron: '0 * * * *',
			timezone: 'UTC'
		});
		store.database
			.query('UPDATE schedules SET next_run_at = ? WHERE id = ?')
			.run('2026-08-28T09:00:00.000Z', schedule.id);

		await service.runDue();
		await service.runDue();

		expect(store.listMessages(null, 'due-session')).toHaveLength(1);
		expect(store.listMessages(null, 'due-session')[0]?.id).toBe(
			`schedule:${schedule.id}:2026-08-28T09:00:00.000Z`
		);
		expect(service.detail(schedule.id).nextRunAt).toBe('2026-08-28T13:00:00.000Z');
		expect(calls).toEqual([`submit:schedule:${schedule.id}:2026-08-28T09:00:00.000Z`]);
		service.close();
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	it('recomputes the next occurrence when the time zone changes', async () => {
		const store = new HUEStore(':memory:');
		const service = new ScheduleService({
			store,
			runtime: { createSession: async (cwd) => ({ sessionId: 'zoned-session', cwd }) },
			dispatcher: { submit: () => undefined, submitAccepted: () => undefined },
			root: () => '/tmp',
			now: () => new Date('2026-03-28T12:00:00Z'),
			startTimer: false
		});
		const schedule = await service.create({
			name: 'Daily',
			prompt: 'Review',
			cron: '0 8 * * *',
			timezone: 'Europe/Amsterdam'
		});

		expect(schedule.nextRunAt).toBe('2026-03-29T06:00:00.000Z');
		expect(service.update(schedule.id, { timezone: 'America/New_York' })).toMatchObject({
			timezone: 'America/New_York',
			nextRunAt: '2026-03-29T12:00:00.000Z'
		});
		service.close();
		store.close();
	});
});
