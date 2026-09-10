import { expect, test } from 'bun:test';
import { ExternalCronService } from './external-cron-service';
import { HUEStore } from './store';

const job = {
	id: 'job-1',
	name: 'Daily review',
	profile: 'default',
	profile_name: 'Default',
	schedule: { kind: 'cron', expr: '0 9 * * *', display: 'Daily at 9:00 AM' },
	enabled: true,
	state: 'scheduled'
};

const run = (sessionId: string, startedAt: number, endReason = 'cron_complete') => ({
	id: sessionId,
	source: 'cron',
	started_at: startedAt,
	ended_at: startedAt + 60,
	end_reason: endReason,
	message_count: 2,
	is_active: false
});

test('baselines existing runs then notifies once for each newly discovered terminal run', async () => {
	const store = new HUEStore(':memory:');
	let runs = [run('cron_job-1_existing', 1_788_080_400)];
	let deliveries = 0;
	const service = new ExternalCronService({
		store,
		autoStart: false,
		onAttention: () => {
			deliveries++;
		},
		transport: {
			async json(path: string) {
				if (path === '/api/cron/jobs?profile=all') return [job];
				if (path.includes('/runs?')) return { runs, limit: 100 };
				throw new Error(`Unexpected path ${path}`);
			}
		}
	});

	await service.poll();
	expect(store.listExternalCronRuns('default', 'job-1')).toHaveLength(1);
	expect(store.externalCronUnreadCount('default', 'job-1')).toBe(0);
	expect(store.notificationCounts()).toEqual({ unread: 0, all: 0 });

	runs = [run('cron_job-1_new', 1_788_166_800), ...runs];
	await service.poll();
	await service.poll();

	expect(store.listExternalCronRuns('default', 'job-1')).toHaveLength(2);
	expect(store.externalCronUnreadCount('default', 'job-1')).toBe(1);
	expect(store.notificationCounts()).toEqual({ unread: 1, all: 1 });
	expect(store.listNotifications({}).items[0]).toMatchObject({
		kind: 'completed',
		body: 'Daily review completed in Default.'
	});
	expect(deliveries).toBe(1);

	const unread = store.listExternalCronRuns('default', 'job-1').find(({ readAt }) => !readAt)!;
	store.markExternalCronRunRead('default', 'job-1', unread.sessionId);
	expect(store.externalCronUnreadCount('default', 'job-1')).toBe(0);
	expect(store.notificationCounts().unread).toBe(0);

	runs = [run('cron_job-1_targeted', 1_788_253_200), ...runs];
	await service.refreshJob('default', 'job-1');
	expect(store.externalCronUnreadCount('default', 'job-1')).toBe(1);
	expect(deliveries).toBe(2);

	await service.close();
	store.close();
});

test('bounds history concurrency and records healthy jobs even when one history fails', async () => {
	const store = new HUEStore(':memory:');
	store.initializeExternalCron('2026-01-01Z');
	let active = 0;
	let peak = 0;
	const service = new ExternalCronService({
		store,
		autoStart: false,
		transport: {
			async json(path) {
				if (!path.includes('/runs?'))
					return Array.from({ length: 12 }, (_, i) => ({ ...job, id: `job-${i}` }));
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active--;
				const id = path.match(/jobs\/(job-\d+)/)![1]!;
				if (id === 'job-0') throw new Error('Unavailable');
				return { runs: [run(`cron_${id}_new`, 1_788_166_800)] };
			}
		}
	});
	try {
		await service.poll();
		expect(peak).toBeLessThanOrEqual(4);
		expect(peak).toBeGreaterThan(1);
		expect(store.notificationCounts().unread).toBe(11);
	} finally {
		await service.close();
		store.close();
	}
});

test('also bounds concurrent targeted history refreshes', async () => {
	const store = new HUEStore(':memory:');
	store.initializeExternalCron('2026-01-01Z');
	let active = 0;
	let peak = 0;
	const service = new ExternalCronService({
		store,
		autoStart: false,
		transport: {
			async json(path) {
				if (!path.includes('/runs?'))
					return Array.from({ length: 10 }, (_, i) => ({ ...job, id: `job-${i}` }));
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active--;
				return { runs: [] };
			}
		}
	});
	try {
		await Promise.all(
			Array.from({ length: 10 }, (_, i) => service.refreshJob('default', `job-${i}`))
		);
		expect(peak).toBeLessThanOrEqual(4);
	} finally {
		await service.close();
		store.close();
	}
});

test('surface refresh joins the active poll and exposes per-job freshness and history coverage', async () => {
	const store = new HUEStore(':memory:');
	let fail = false;
	let inventories = 0;
	let now = new Date('2026-09-01Z');
	const service = new ExternalCronService({
		store,
		autoStart: false,
		now: () => now,
		transport: {
			async json(path) {
				if (!path.includes('/runs?')) {
					inventories++;
					return [job];
				}
				if (fail) throw new Error('Private upstream detail');
				return { runs: [run('cron_job-1_existing', 1_788_080_400)] };
			}
		}
	});
	try {
		const poll = service.poll();
		const surface = service.refreshSurface();
		expect(surface).toBe(poll);
		const first = await surface;
		expect(inventories).toBe(1);
		expect(first.jobs[0]).toMatchObject({
			jobId: 'job-1',
			unreadCount: 0,
			refreshedAt: '2026-09-01T00:00:00.000Z',
			error: null,
			history: { limit: 100, possiblyTruncated: false, paginationSupported: false }
		});
		fail = true;
		now = new Date('2026-09-02Z');
		const second = await service.refreshSurface();
		expect(second.jobs[0]).toMatchObject({
			refreshedAt: '2026-09-01T00:00:00.000Z',
			error: 'Hermes cron history unavailable'
		});
		expect(JSON.stringify(second)).not.toContain('Private upstream detail');
	} finally {
		await service.close();
		store.close();
	}
});

test('partial first baseline does not suppress later healthy runs or notify recovered old history', async () => {
	const store = new HUEStore(':memory:');
	let fail = true;
	let fresh = false;
	const service = new ExternalCronService({
		store,
		autoStart: false,
		transport: {
			async json(path) {
				if (!path.includes('/runs?')) return [job, { ...job, id: 'job-2' }];
				if (path.includes('job-2')) {
					if (fail) throw new Error('Unavailable');
					return { runs: [run('cron_job-2_old', 1_788_080_400)] };
				}
				return {
					runs: [
						run('cron_job-1_old', 1_788_080_400),
						...(fresh ? [run('cron_job-1_new', 1_788_166_800)] : [])
					]
				};
			}
		}
	});
	try {
		await service.poll();
		expect(store.listExternalCronRuns('default', 'job-1')).toHaveLength(1);
		fresh = true;
		await service.poll();
		expect(store.notificationCounts().unread).toBe(1);
		fail = false;
		await service.poll();
		expect(store.externalCronInitialized()).toBe(true);
		expect(store.externalCronUnreadCount('default', 'job-2')).toBe(0);
		expect(store.notificationCounts().unread).toBe(1);
	} finally {
		await service.close();
		store.close();
	}
});
