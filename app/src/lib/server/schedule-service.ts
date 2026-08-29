import { nextCronOccurrence, parseCron } from './cron';
import type { MessageEnvelope } from './message-dispatcher';
import type { HUEStore, Schedule } from './store';

type ScheduleRuntime = {
	createSession(cwd: string): Promise<{ sessionId: string; cwd: string }>;
};

type ScheduleDispatcher = {
	submit(envelope: MessageEnvelope): unknown;
	submitAccepted(
		envelope: MessageEnvelope,
		accepted: { duplicate: boolean; status: import('./store').MessageStatus }
	): unknown;
};

function required(value: unknown, label: string, maximum: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > maximum ||
		value.includes('\0')
	) {
		throw new Error(`${label} is required`);
	}
	return value.trim();
}

export class ScheduleService {
	private timer?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		private readonly dependencies: {
			store: HUEStore;
			runtime: ScheduleRuntime;
			dispatcher: ScheduleDispatcher;
			root: () => string;
			now?: () => Date;
			startTimer?: boolean;
		}
	) {
		if (dependencies.startTimer !== false) this.tick();
	}

	list(): Schedule[] {
		return this.dependencies.store.listSchedules();
	}

	detail(id: string): Schedule & {
		messages: ReturnType<HUEStore['listMessages']>;
		events: ReturnType<HUEStore['listEvents']>;
	} {
		const schedule = this.dependencies.store.getSchedule(id);
		if (!schedule) throw new Error('Schedule not found');
		return {
			...schedule,
			messages: this.dependencies.store.listMessages(null, schedule.sessionId),
			events: this.dependencies.store.listEvents(null, schedule.sessionId)
		};
	}

	async create(input: { name: unknown; prompt: unknown; cron: unknown }): Promise<Schedule> {
		const name = required(input.name, 'Schedule name', 128);
		const prompt = required(input.prompt, 'Schedule prompt', 100_000);
		const cron = required(input.cron, 'Schedule cron', 256);
		parseCron(cron);
		const nextRunAt = nextCronOccurrence(cron, this.now()).toISOString();
		const root = this.dependencies.root();
		const session = await this.dependencies.runtime.createSession(root);
		if (session.cwd !== root)
			throw new Error('Hermes created the Session outside the HUE session directory');
		this.dependencies.store.upsertSession(null, { ...session, title: name });
		this.dependencies.store.updateSession(null, session.sessionId, {
			title: name,
			folder: 'Schedules'
		});
		const schedule = this.dependencies.store.createSchedule({
			id: crypto.randomUUID(),
			name,
			prompt,
			cron,
			enabled: true,
			nextRunAt,
			sessionId: session.sessionId
		});
		this.arm();
		return schedule;
	}

	update(id: string, input: { name?: unknown; prompt?: unknown; cron?: unknown }): Schedule {
		const current = this.require(id);
		const patch: Partial<Pick<Schedule, 'name' | 'prompt' | 'cron' | 'nextRunAt'>> = {};
		if (input.name !== undefined) patch.name = required(input.name, 'Schedule name', 128);
		if (input.prompt !== undefined)
			patch.prompt = required(input.prompt, 'Schedule prompt', 100_000);
		if (input.cron !== undefined) {
			patch.cron = required(input.cron, 'Schedule cron', 256);
			parseCron(patch.cron);
			patch.nextRunAt = nextCronOccurrence(patch.cron, this.now()).toISOString();
		}
		const updated = this.dependencies.store.updateSchedule(id, patch);
		if (patch.name)
			this.dependencies.store.updateSession(null, current.sessionId, { title: patch.name });
		this.arm();
		return updated;
	}

	pause(id: string): Schedule {
		const schedule = this.dependencies.store.updateSchedule(this.require(id).id, {
			enabled: false
		});
		this.arm();
		return schedule;
	}

	resume(id: string): Schedule {
		const current = this.require(id);
		const schedule = this.dependencies.store.updateSchedule(id, {
			enabled: true,
			nextRunAt: nextCronOccurrence(current.cron, this.now()).toISOString()
		});
		this.arm();
		return schedule;
	}

	delete(id: string): { deleted: Schedule } {
		const schedule = this.require(id);
		this.dependencies.store.deleteSchedule(id);
		this.arm();
		return { deleted: schedule };
	}

	runNow(id: string, runId: string) {
		const schedule = this.require(id);
		const messageId = required(runId, 'runId', 500);
		const envelope: MessageEnvelope = {
			id: messageId,
			projectId: null,
			sessionId: schedule.sessionId,
			text: schedule.prompt,
			images: [],
			attachments: [],
			reviewContexts: []
		};
		return this.dependencies.dispatcher.submit(envelope);
	}

	async runDue(): Promise<void> {
		const now = this.now();
		for (const schedule of this.dependencies.store.listDueSchedules(now.toISOString())) {
			const accepted = this.dependencies.store.acceptDueSchedule(
				schedule.id,
				schedule.nextRunAt,
				nextCronOccurrence(schedule.cron, now).toISOString()
			);
			if (accepted)
				this.dependencies.dispatcher.submitAccepted(accepted.envelope, accepted.accepted);
		}
	}

	close(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private require(id: string): Schedule {
		const schedule = this.dependencies.store.getSchedule(required(id, 'Schedule id', 128));
		if (!schedule) throw new Error('Schedule not found');
		return schedule;
	}

	private now(): Date {
		return new Date((this.dependencies.now ?? (() => new Date()))());
	}

	private arm(): void {
		if (this.closed || this.dependencies.startTimer === false) return;
		if (this.timer) clearTimeout(this.timer);
		const next = this.dependencies.store
			.listSchedules()
			.filter(({ enabled }) => enabled)
			.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))[0];
		if (!next) {
			this.timer = undefined;
			return;
		}
		const delay = Math.max(
			0,
			Math.min(Date.parse(next.nextRunAt) - this.now().getTime(), 2_147_483_647)
		);
		this.timer = setTimeout(() => this.tick(), delay);
		this.timer.unref?.();
	}

	private tick(): void {
		void this.runDue()
			.catch(() => console.error('[schedules] Failed to process due schedules'))
			.finally(() => this.arm());
	}
}
