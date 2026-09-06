type CronField = { values: Set<number>; wildcard: boolean };
export type ParsedCron = {
	minute: CronField;
	hour: CronField;
	day: CronField;
	month: CronField;
	weekday: CronField;
};

function field(
	source: string,
	minimum: number,
	maximum: number,
	label: string,
	sunday = false
): CronField {
	const values = new Set<number>();
	const add = (value: number) => {
		const normalized = sunday && value === 7 ? 0 : value;
		if (!Number.isInteger(value) || value < minimum || value > maximum) {
			throw new Error(`Invalid cron ${label}`);
		}
		values.add(normalized);
	};
	for (const part of source.split(',')) {
		const [base, rawStep] = part.split('/');
		if (!base || part.split('/').length > 2) throw new Error(`Invalid cron ${label}`);
		if (rawStep !== undefined && !/^\d+$/.test(rawStep)) throw new Error(`Invalid cron ${label}`);
		const step = rawStep === undefined ? 1 : Number(rawStep);
		if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron ${label}`);
		let start: number;
		let end: number;
		if (base === '*') {
			start = minimum;
			end = maximum;
		} else if (base.includes('-')) {
			if (!/^\d+-\d+$/.test(base)) throw new Error(`Invalid cron ${label}`);
			const bounds = base.split('-').map(Number);
			if (bounds.length !== 2 || bounds.some((value) => !Number.isInteger(value))) {
				throw new Error(`Invalid cron ${label}`);
			}
			[start, end] = bounds;
			if (start > end) throw new Error(`Invalid cron ${label}`);
		} else {
			if (!/^\d+$/.test(base)) throw new Error(`Invalid cron ${label}`);
			start = Number(base);
			end = rawStep === undefined ? start : maximum;
		}
		for (let value = start; value <= end; value += step) add(value);
	}
	if (!values.size) throw new Error(`Invalid cron ${label}`);
	return { values, wildcard: source.startsWith('*') };
}

export function parseCron(expression: string): ParsedCron {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) throw new Error('Cron expression must have five fields');
	return {
		minute: field(parts[0]!, 0, 59, 'minute'),
		hour: field(parts[1]!, 0, 23, 'hour'),
		day: field(parts[2]!, 1, 31, 'day of month'),
		month: field(parts[3]!, 1, 12, 'month'),
		weekday: field(parts[4]!, 0, 7, 'day of week', true)
	};
}

export function normalizeTimeZone(value: string): string {
	try {
		return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		throw new Error('Invalid time zone');
	}
}

export function systemTimeZone(): string {
	return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

function matches(cron: ParsedCron, date: Temporal.PlainDateTime): boolean {
	const day = cron.day.values.has(date.day);
	const weekday = cron.weekday.values.has(date.dayOfWeek % 7);
	const calendarDay = cron.day.wildcard ? weekday : cron.weekday.wildcard ? day : day || weekday;
	return (
		cron.minute.values.has(date.minute) &&
		cron.hour.values.has(date.hour) &&
		cron.month.values.has(date.month) &&
		calendarDay
	);
}

export function nextCronOccurrence(
	expression: string,
	after: Date,
	timeZone: string,
	maximumMinutes = 366 * 24 * 60 * 5
): Date {
	const cron = parseCron(expression);
	const zone = normalizeTimeZone(timeZone);
	const afterMilliseconds = after.getTime();
	if (!Number.isFinite(afterMilliseconds)) throw new Error('Invalid schedule date');
	let candidate = Temporal.Instant.fromEpochMilliseconds(afterMilliseconds)
		.toZonedDateTimeISO(zone)
		.toPlainDateTime()
		.with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 })
		.add({ minutes: 1 });
	for (let minute = 0; minute < maximumMinutes; minute += 1) {
		if (matches(cron, candidate)) {
			const zoned = candidate.toZonedDateTime(zone, { disambiguation: 'earlier' });
			const milliseconds = Number(zoned.epochMilliseconds);
			if (zoned.toPlainDateTime().equals(candidate) && milliseconds > afterMilliseconds) {
				return new Date(milliseconds);
			}
		}
		candidate = candidate.add({ minutes: 1 });
	}
	throw new Error('Cron expression has no occurrence within five years');
}
