import { expect, test } from 'bun:test';
import {
	deleteExternalHermesCron,
	getExternalHermesCron,
	listExternalHermesCron,
	listExternalHermesCronRuns,
	setExternalHermesCronEnabled,
	updateExternalHermesCron
} from './external-hermes-cron';

test('projects external Hermes cron jobs through one read-only allowlisted request', async () => {
	const calls: Array<[string, RequestInit | undefined]> = [];
	const jobs = await listExternalHermesCron({
		async json(path, init) {
			calls.push([path, init]);
			return [
				{
					id: 'af28bd12971a',
					name: 'Daily review',
					profile: 'default',
					profile_name: 'Default',
					schedule: { kind: 'cron', expr: '0 9 * * *', display: 'Daily at 9:00 AM' },
					enabled: true,
					state: 'scheduled',
					next_run_at: '2026-08-30T09:00:00Z',
					last_run_at: '2026-08-29T09:00:00Z',
					last_status: 'completed',
					prompt: 'private prompt',
					deliver: 'telegram:secret',
					origin: { chat_id: 'secret' },
					hermes_home: '/private/home',
					last_error: 'secret failure'
				}
			];
		}
	});

	expect(calls).toEqual([['/api/cron/jobs?profile=all', undefined]]);
	expect(jobs).toEqual([
		{
			jobId: 'af28bd12971a',
			name: 'Daily review',
			profile: 'default',
			profileName: 'Default',
			schedule: 'Daily at 9:00 AM',
			scheduleKind: 'cron',
			enabled: true,
			state: 'scheduled',
			nextRunAt: '2026-08-30T09:00:00Z',
			lastRunAt: '2026-08-29T09:00:00Z',
			lastStatus: 'completed'
		}
	]);
	expect(JSON.stringify(jobs)).not.toMatch(/private prompt|telegram|secret|hermes_home|last_error/);
});

test('drops malformed and duplicate external jobs without failing the inventory', async () => {
	const jobs = await listExternalHermesCron({
		async json() {
			return [
				{ id: 'valid-job', name: 'Valid', profile: 'default', schedule_display: 'Every hour' },
				{ id: 'valid-job', name: 'Duplicate', profile: 'default' },
				{ id: '', name: 'Missing id', profile: 'default' },
				{ id: 'wrong-name', name: {}, profile: 'default' },
				null
			];
		}
	});

	expect(jobs).toHaveLength(1);
	expect(jobs[0]).toMatchObject({ jobId: 'valid-job', schedule: 'Every hour' });
});

test('reads, updates, pauses, and removes only the selected profile job', async () => {
	const calls: Array<[string, RequestInit | undefined]> = [];
	const transport = {
		async json(path: string, init?: RequestInit) {
			calls.push([path, init]);
			return {
				id: 'job-1',
				name: 'Daily review',
				prompt: 'Review progress',
				deliver: 'local',
				model: null,
				provider: null,
				schedule: { kind: 'cron', expr: '0 9 * * *', display: 'Daily at 9:00 AM' },
				schedule_display: 'Daily at 9:00 AM',
				enabled: true,
				state: 'scheduled',
				no_agent: false
			};
		}
	};

	await expect(getExternalHermesCron(transport, 'work profile', 'job-1')).resolves.toMatchObject({
		jobId: 'job-1',
		name: 'Daily review',
		prompt: 'Review progress',
		schedule: '0 9 * * *',
		deliver: 'local',
		scriptOnly: false
	});
	await updateExternalHermesCron(transport, 'work profile', 'job-1', {
		name: 'Morning review',
		prompt: 'Review safely',
		schedule: '30 8 * * *',
		deliver: 'local',
		model: '',
		provider: ''
	});
	await setExternalHermesCronEnabled(transport, 'work profile', 'job-1', false);
	await deleteExternalHermesCron(transport, 'work profile', 'job-1');

	expect(calls.map(([path]) => path)).toEqual([
		'/api/cron/jobs/job-1?profile=work%20profile',
		'/api/cron/jobs/job-1?profile=work%20profile',
		'/api/cron/jobs/job-1/pause?profile=work%20profile',
		'/api/cron/jobs/job-1?profile=work%20profile'
	]);
	expect(calls[1]?.[1]).toMatchObject({
		method: 'PUT',
		body: JSON.stringify({
			updates: {
				name: 'Morning review',
				prompt: 'Review safely',
				schedule: '30 8 * * *',
				deliver: 'local',
				model: null,
				provider: null
			}
		})
	});
	expect(calls[2]?.[1]?.method).toBe('POST');
	expect(calls[3]?.[1]?.method).toBe('DELETE');
});

test('normalizes profile-scoped Hermes cron run Sessions conservatively', async () => {
	const runs = await listExternalHermesCronRuns(
		{
			async json() {
				return {
					runs: [
						{
							id: 'cron_job-1_20260830_090000',
							source: 'cron',
							started_at: 1788080400,
							ended_at: 1788080460,
							end_reason: 'cron_complete',
							message_count: 2,
							is_active: false
						},
						{
							id: 'cron_job-1_20260829_090000',
							source: 'cron',
							started_at: 1787994000,
							ended_at: 1787994060,
							end_reason: 'cron_incomplete_no_output',
							message_count: 1,
							is_active: false
						},
						{
							id: 'cron_job-1_20260828_090000',
							source: 'cron',
							started_at: 1787907600,
							ended_at: null,
							end_reason: null,
							message_count: 1,
							is_active: false
						},
						{ id: 'other-session', source: 'acp' }
					]
				};
			}
		},
		'default',
		'job-1'
	);

	expect(runs.map(({ status }) => status)).toEqual(['completed', 'failed', 'unknown']);
	expect(runs[0]).toMatchObject({
		sessionId: 'cron_job-1_20260830_090000',
		profile: 'default',
		messageCount: 2,
		endReason: 'cron_complete'
	});
});
