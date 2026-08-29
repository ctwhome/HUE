import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleService } from './schedule-service';
import { HUEStore } from './store';

describe('ScheduleService', () => {
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
			service.create({ name: 'Impossible', prompt: 'Never', cron: '0 0 31 2 *' })
		).rejects.toThrow('no occurrence');
		expect(sessions).toBe(0);
		expect(store.listSchedules()).toEqual([]);
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
			cron: '0 9 * * *'
		});
		const next = schedule.nextRunAt;
		await service.runNow(schedule.id, 'client-run-1');

		expect(service.detail(schedule.id).nextRunAt).toBe(next);
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
		const schedule = await service.create({ name: 'Hourly', prompt: 'Run', cron: '0 * * * *' });
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
});
