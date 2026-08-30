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
