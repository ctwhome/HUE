import { redactHermesValue } from './redaction';

export type ExternalHermesCronJob = {
	jobId: string;
	name: string;
	profile: string;
	profileName: string;
	schedule: string;
	scheduleKind: 'cron' | 'interval' | 'once' | 'unknown';
	enabled: boolean;
	state: 'scheduled' | 'paused' | 'completed' | 'error' | 'unknown';
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastStatus: string | null;
};

export type ExternalHermesCronDetail = ExternalHermesCronJob & {
	prompt: string;
	deliver: string;
	model: string;
	provider: string;
	scriptOnly: boolean;
};

type Transport = { json(path: string, init?: RequestInit): Promise<unknown> };

const safeString = (value: unknown, maximum: number) => {
	if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0'))
		return null;
	const redacted = redactHermesValue(value.trim());
	return typeof redacted === 'string' ? redacted : null;
};

const rawString = (value: unknown, maximum: number) =>
	typeof value === 'string' && value.trim() && value.length <= maximum && !value.includes('\0')
		? value.trim()
		: null;

const timestamp = (value: unknown) => {
	const text = safeString(value, 64);
	return text && Number.isFinite(Date.parse(text)) ? text : null;
};

export async function listExternalHermesCron(
	transport: Transport
): Promise<ExternalHermesCronJob[]> {
	const result = await transport.json('/api/cron/jobs?profile=all');
	if (!Array.isArray(result)) throw new Error('Hermes returned invalid cron inventory');
	const jobs: ExternalHermesCronJob[] = [];
	const seen = new Set<string>();
	for (const value of result.slice(0, 1_000)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const job = value as Record<string, unknown>;
		const jobId = safeString(job.id, 128);
		const name = safeString(job.name, 200);
		const profile = safeString(job.profile, 64);
		if (!jobId || !name || !profile || !/^[A-Za-z0-9_-]+$/.test(jobId)) continue;
		const key = `${profile}:${jobId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const scheduleValue =
			job.schedule && typeof job.schedule === 'object' && !Array.isArray(job.schedule)
				? (job.schedule as Record<string, unknown>)
				: {};
		const kind = ['cron', 'interval', 'once'].includes(String(scheduleValue.kind))
			? (scheduleValue.kind as ExternalHermesCronJob['scheduleKind'])
			: 'unknown';
		const state = ['scheduled', 'paused', 'completed', 'error'].includes(String(job.state))
			? (job.state as ExternalHermesCronJob['state'])
			: 'unknown';
		jobs.push({
			jobId,
			name,
			profile,
			profileName: safeString(job.profile_name, 100) ?? profile,
			schedule:
				safeString(scheduleValue.display, 200) ??
				safeString(job.schedule_display, 200) ??
				'Unknown schedule',
			scheduleKind: kind,
			enabled: job.enabled === true,
			state,
			nextRunAt: timestamp(job.next_run_at),
			lastRunAt: timestamp(job.last_run_at),
			lastStatus: safeString(job.last_status, 64)
		});
	}
	return jobs;
}

const reference = (value: unknown, name: string) => {
	const text = rawString(value, 128);
	if (!text || !/^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/.test(text))
		throw new Error(`${name} is invalid`);
	return text;
};

const required = (value: unknown, name: string, maximum: number) => {
	const text = rawString(value, maximum);
	if (!text) throw new Error(`${name} is required`);
	return text;
};

const optional = (value: unknown, name: string, maximum: number) => {
	if (value === '' || value === null || value === undefined) return '';
	const text = rawString(value, maximum);
	if (!text) throw new Error(`${name} is invalid`);
	return text;
};

const jobPath = (profile: string, jobId: string, suffix = '') =>
	`/api/cron/jobs/${encodeURIComponent(reference(jobId, 'Job id'))}${suffix}?profile=${encodeURIComponent(reference(profile, 'Profile'))}`;

function detail(value: unknown, profile: string): ExternalHermesCronDetail {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Hermes returned invalid cron job');
	const job = value as Record<string, unknown>;
	const scheduleValue =
		job.schedule && typeof job.schedule === 'object' && !Array.isArray(job.schedule)
			? (job.schedule as Record<string, unknown>)
			: {};
	const scheduleKind = ['cron', 'interval', 'once'].includes(String(scheduleValue.kind))
		? (scheduleValue.kind as ExternalHermesCronJob['scheduleKind'])
		: 'unknown';
	const state = ['scheduled', 'paused', 'completed', 'error'].includes(String(job.state))
		? (job.state as ExternalHermesCronJob['state'])
		: 'unknown';
	return {
		jobId: required(job.id, 'Job id', 128),
		name: required(job.name, 'Job name', 200),
		profile,
		profileName: profile,
		schedule:
			rawString(scheduleValue.expr, 256) ??
			rawString(job.schedule_display, 256) ??
			rawString(scheduleValue.display, 256) ??
			'',
		scheduleKind,
		enabled: job.enabled === true,
		state,
		nextRunAt: timestamp(job.next_run_at),
		lastRunAt: timestamp(job.last_run_at),
		lastStatus: rawString(job.last_status, 64),
		prompt:
			typeof job.prompt === 'string' &&
			job.prompt.length <= 100_000 &&
			!job.prompt.includes('\0')
				? job.prompt
				: '',
		deliver: rawString(job.deliver, 1_000) ?? 'local',
		model: rawString(job.model, 256) ?? '',
		provider: rawString(job.provider, 128) ?? '',
		scriptOnly: job.no_agent === true
	};
}

export async function getExternalHermesCron(
	transport: Transport,
	profile: string,
	jobId: string
): Promise<ExternalHermesCronDetail> {
	return detail(await transport.json(jobPath(profile, jobId)), profile);
}

export async function updateExternalHermesCron(
	transport: Transport,
	profile: string,
	jobId: string,
	input: Record<string, unknown>
): Promise<ExternalHermesCronDetail> {
	const updates = {
		name: required(input.name, 'Name', 200),
		prompt: optional(input.prompt, 'Prompt', 100_000).trim(),
		schedule: required(input.schedule, 'Schedule', 256),
		deliver: required(input.deliver, 'Delivery', 1_000),
		model: optional(input.model, 'Model', 256) || null,
		provider: optional(input.provider, 'Provider', 128) || null
	};
	return detail(
		await transport.json(jobPath(profile, jobId), {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ updates })
		}),
		profile
	);
}

export async function setExternalHermesCronEnabled(
	transport: Transport,
	profile: string,
	jobId: string,
	enabled: boolean
): Promise<ExternalHermesCronDetail> {
	return detail(
		await transport.json(jobPath(profile, jobId, enabled ? '/resume' : '/pause'), {
			method: 'POST'
		}),
		profile
	);
}

export async function deleteExternalHermesCron(
	transport: Transport,
	profile: string,
	jobId: string
): Promise<void> {
	await transport.json(jobPath(profile, jobId), { method: 'DELETE' });
}
