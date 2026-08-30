import {
	listExternalHermesCron,
	listExternalHermesCronRuns,
	type ExternalHermesCronJob
} from './external-hermes-cron';
import type { HUEStore } from './store';

const POLL_INTERVAL_MS = 30 * 60 * 1_000;

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
	private active: Promise<void> | null = null;
	private closed = false;

	constructor(private readonly dependencies: Dependencies) {
		this.now = dependencies.now ?? (() => new Date());
		this.interval = dependencies.pollIntervalMs ?? POLL_INTERVAL_MS;
		this.autoStart = dependencies.autoStart ?? true;
		if (this.autoStart) void this.poll().catch(() => undefined);
	}

	poll(): Promise<void> {
		if (this.closed) return Promise.resolve();
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
		if (!this.dependencies.store.externalCronInitialized()) {
			await this.poll();
			return;
		}
		const jobs = await listExternalHermesCron(this.dependencies.transport);
		const job = jobs.find((candidate) => candidate.profile === profile && candidate.jobId === jobId);
		if (!job) throw new Error('Hermes cron job not found');
		const runs = await listExternalHermesCronRuns(this.dependencies.transport, profile, jobId);
		const created = await this.record(job, runs, false);
		if (created && this.dependencies.onAttention) await this.dependencies.onAttention();
	}

	private async run(): Promise<void> {
		const jobs = await listExternalHermesCron(this.dependencies.transport);
		const histories = await Promise.all(
			jobs.map(async (job) => ({
				job,
				runs: await listExternalHermesCronRuns(
					this.dependencies.transport,
					job.profile,
					job.jobId
				)
			}))
		);
		const baseline = !this.dependencies.store.externalCronInitialized();
		let created = false;
		for (const { job, runs } of histories) {
			created = (await this.record(job, runs, baseline)) || created;
		}
		if (baseline) this.dependencies.store.initializeExternalCron(this.now().toISOString());
		if (created && !baseline && this.dependencies.onAttention) {
			await this.dependencies.onAttention();
		}
	}

	private async record(
		job: ExternalHermesCronJob,
		runs: Awaited<ReturnType<typeof listExternalHermesCronRuns>>,
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
