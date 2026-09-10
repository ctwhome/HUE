import {
	listExternalHermesCron,
	listExternalHermesCronRuns,
	type ExternalHermesCronHistory,
	type ExternalHermesCronJob
} from './external-hermes-cron';
import type { HUEStore } from './store';

const POLL_INTERVAL_MS = 30 * 60 * 1_000;

export type ExternalCronProjection = {
	jobs: Array<
		ExternalHermesCronJob & {
			unreadCount: number;
			refreshedAt: string | null;
			error: string | null;
			history: Omit<ExternalHermesCronHistory, 'runs'> | null;
		}
	>;
};

type Dependencies = {
	store: HUEStore;
	transport: { json(path: string, init?: RequestInit): Promise<unknown> };
	onAttention?: () => Promise<void> | void;
	now?: () => Date;
	pollIntervalMs?: number;
	autoStart?: boolean;
};

export class ExternalCronService {
	private readonly now: () => Date;
	private readonly interval: number;
	private readonly autoStart: boolean;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private active: Promise<ExternalCronProjection> | null = null;
	private closed = false;
	private projection: ExternalCronProjection = { jobs: [] };
	private readonly baselined = new Set<string>();
	private historyReaders = 0;
	private readonly historyWaiters: Array<() => void> = [];

	constructor(private readonly dependencies: Dependencies) {
		this.now = dependencies.now ?? (() => new Date());
		this.interval = dependencies.pollIntervalMs ?? POLL_INTERVAL_MS;
		this.autoStart = dependencies.autoStart ?? true;
		if (this.autoStart) void this.poll().catch(() => undefined);
	}

	refreshSurface(): Promise<ExternalCronProjection> {
		return this.poll();
	}

	poll(): Promise<ExternalCronProjection> {
		if (this.closed) return Promise.resolve(this.projection);
		if (this.active) return this.active;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const active = this.run();
		this.active = active;
		void active
			.finally(() => {
				if (this.active === active) this.active = null;
				if (this.autoStart && !this.closed) this.arm();
			})
			.catch(() => undefined);
		return active;
	}

	async refreshJob(profile: string, jobId: string): Promise<void> {
		if (this.active || !this.dependencies.store.externalCronInitialized()) {
			const result = await this.poll();
			const job = result.jobs.find((job) => job.profile === profile && job.jobId === jobId);
			if (!job) throw new Error('Hermes cron job not found');
			if (job.error) throw new Error(job.error);
			return;
		}
		const jobs = await listExternalHermesCron(this.dependencies.transport);
		const job = jobs.find(
			(candidate) => candidate.profile === profile && candidate.jobId === jobId
		);
		if (!job) throw new Error('Hermes cron job not found');
		const { runs } = await this.readHistory(profile, jobId);
		const created = await this.record(job, runs, false);
		if (created && this.dependencies.onAttention) await this.dependencies.onAttention();
	}

	private async run(): Promise<ExternalCronProjection> {
		const jobs = await listExternalHermesCron(this.dependencies.transport);
		const baseline = !this.dependencies.store.externalCronInitialized();
		let created = false;
		const results: ExternalCronProjection['jobs'] = new Array(jobs.length);
		const previousJobs = new Map(
			this.projection.jobs.map((job) => [JSON.stringify([job.profile, job.jobId]), job])
		);
		let index = 0;
		await Promise.all(
			Array.from({ length: Math.min(4, jobs.length) }, async () => {
				while (index < jobs.length) {
					const position = index++;
					const job = jobs[position]!;
					const key = JSON.stringify([job.profile, job.jobId]);
					const previous = previousJobs.get(key);
					let refreshedAt = previous?.refreshedAt ?? null;
					let history = previous?.history ?? null;
					let error: string | null = null;
					try {
						const { runs, ...coverage } = await this.readHistory(job.profile, job.jobId);
						const jobBaseline = baseline && !this.baselined.has(key);
						const recorded = await this.record(job, runs, jobBaseline);
						created = (recorded && !jobBaseline) || created;
						if (baseline) this.baselined.add(key);
						refreshedAt = this.now().toISOString();
						history = coverage;
					} catch {
						error = 'Hermes cron history unavailable';
					}
					results[position] = {
						...job,
						refreshedAt,
						history,
						error,
						unreadCount: this.dependencies.store.externalCronUnreadCount(job.profile, job.jobId)
					};
				}
			})
		);
		// Keep failed first reads in baseline mode; healthy jobs can notify on subsequent passes.
		if (baseline && results.every((job) => !job.error)) {
			this.dependencies.store.initializeExternalCron(this.now().toISOString());
			this.baselined.clear();
		}
		this.projection = { jobs: results };
		if (created && this.dependencies.onAttention) {
			await this.dependencies.onAttention();
		}
		return this.projection;
	}

	private async readHistory(profile: string, jobId: string): Promise<ExternalHermesCronHistory> {
		if (this.historyReaders >= 4)
			await new Promise<void>((resolve) => this.historyWaiters.push(resolve));
		else this.historyReaders++;
		try {
			return await listExternalHermesCronRuns(this.dependencies.transport, profile, jobId);
		} finally {
			const next = this.historyWaiters.shift();
			if (next) next();
			else this.historyReaders--;
		}
	}

	private async record(
		job: ExternalHermesCronJob,
		runs: ExternalHermesCronHistory['runs'],
		baseline: boolean
	): Promise<boolean> {
		const discoveredAt = this.now().toISOString();
		let created = false;
		for (const run of runs) {
			created =
				this.dependencies.store.recordExternalCronRun(
					{
						...run,
						profileName: job.profileName,
						jobId: job.jobId,
						jobName: job.name,
						discoveredAt
					},
					!baseline
				) || created;
		}
		return created;
	}

	private arm() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.poll().catch(() => undefined), this.interval);
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		await this.active?.catch(() => undefined);
	}
}
