import { describe, expect, it, spyOn } from 'bun:test';
import { nextCronOccurrence, parseCron } from './cron';

describe('five-field cron', () => {
	it('skips sparse calendar fields instead of walking millions of minutes', () => {
		const original = Temporal.PlainDateTime.prototype.add;
		let steps = 0;
		const add = spyOn(Temporal.PlainDateTime.prototype, 'add').mockImplementation(function (
			this: Temporal.PlainDateTime,
			...args: Parameters<typeof original>
		) {
			if (++steps > 5_000) throw new Error('Minute walk exceeded calendar-skip budget');
			return original.apply(this, args);
		});
		try {
			expect(nextCronOccurrence('0 0 1 1 *', new Date('2026-01-01Z'), 'UTC')).toEqual(
				new Date('2027-01-01Z')
			);
			expect(() => nextCronOccurrence('0 0 31 2 *', new Date('2026-01-01Z'), 'UTC')).toThrow(
				'no occurrence'
			);
			expect(nextCronOccurrence('0 0 29 2 *', new Date('2025-03-01Z'), 'UTC')).toEqual(
				new Date('2028-02-29Z')
			);
		} finally {
			add.mockRestore();
		}
	});

	it('keeps the civil-minute search horizon exclusive across skips', () => {
		expect(() => nextCronOccurrence('0 0 1 2 *', new Date('2026-01-01Z'), 'UTC', 60)).toThrow(
			'no occurrence'
		);
		expect(() => nextCronOccurrence('2 * * * *', new Date('2026-01-01Z'), 'UTC', 1)).toThrow(
			'no occurrence'
		);
		expect(nextCronOccurrence('2 * * * *', new Date('2026-01-01Z'), 'UTC', 2)).toEqual(
			new Date('2026-01-01T00:02Z')
		);
	});
	it('supports wildcards, values, lists, ranges, steps, and Sunday 0 or 7', () => {
		expect(parseCron('*/15 9-10 * * 0,7')).toBeTruthy();
		expect(
			nextCronOccurrence('*/15 9-10 * * 0,7', new Date('2026-08-29T10:59:00Z'), 'UTC')
		).toEqual(new Date('2026-08-30T09:00:00Z'));
	});

	it('uses standard day-of-month or day-of-week matching and rejects invalid expressions', () => {
		expect(nextCronOccurrence('0 9 1 * 1', new Date('2026-08-31T09:00:00Z'), 'UTC')).toEqual(
			new Date('2026-09-01T09:00:00Z')
		);
		expect(() => parseCron('0 24 * * *')).toThrow('Invalid cron hour');
		expect(() => parseCron('* * * *')).toThrow('five fields');
		expect(() => parseCron('-1 * * * *')).toThrow('Invalid cron minute');
		expect(() => parseCron('1- * * * *')).toThrow('Invalid cron minute');
		expect(() => nextCronOccurrence('0 9 * * *', new Date(), 'Not/AZone')).toThrow(
			'Invalid time zone'
		);
	});

	it('treats stepped day fields as wildcards for standard day matching', () => {
		expect(nextCronOccurrence('0 9 */2 * 1', new Date('2026-08-31T09:00:00Z'), 'UTC')).toEqual(
			new Date('2026-09-07T09:00:00Z')
		);
	});

	it('keeps weekday wall time stable when daylight-saving offset changes', () => {
		expect(
			nextCronOccurrence('0 8 * * 1-5', new Date('2026-03-27T07:00:00Z'), 'Europe/Amsterdam')
		).toEqual(new Date('2026-03-30T06:00:00Z'));
	});

	it('skips missing spring-forward times and does not repeat fall-back times', () => {
		expect(
			nextCronOccurrence('30 2 * * *', new Date('2026-03-28T23:00:00Z'), 'Europe/Amsterdam')
		).toEqual(new Date('2026-03-30T00:30:00Z'));
		expect(
			nextCronOccurrence('30 2 * * *', new Date('2026-10-25T00:30:00Z'), 'Europe/Amsterdam')
		).toEqual(new Date('2026-10-26T01:30:00Z'));
		expect(
			nextCronOccurrence('30 2 * * *', new Date('2026-10-25T01:15:00Z'), 'Europe/Amsterdam')
		).toEqual(new Date('2026-10-26T01:30:00Z'));
	});

	it('supports zones with non-hour offsets', () => {
		expect(
			nextCronOccurrence('0 8 * * *', new Date('2026-01-01T00:00:00Z'), 'Asia/Kathmandu')
		).toEqual(new Date('2026-01-01T02:15:00Z'));
	});

	it('matches a civil-minute reference walk across calendar and timezone boundaries', () => {
		for (const [zone, after, expression] of [
			['Australia/Lord_Howe', '2026-10-03T15:00Z', '*/5 2 * * *'],
			['Australia/Lord_Howe', '2026-04-04T15:05Z', '45 1 * * *'],
			['Pacific/Apia', '2011-12-29T20:00Z', '0 9 * * *'],
			['Europe/Amsterdam', '2026-10-25T01:15Z', '*/15 2-3 * * *'],
			['UTC', '2026-01-31T23:59Z', '7,13 0-3 1 2 1'],
			['Asia/Kathmandu', '2026-08-31T18:14:59Z', '*/7 * */2 * 2']
		]) {
			const cron = parseCron(expression!);
			const date = new Date(after!);
			let candidate = Temporal.Instant.fromEpochMilliseconds(date.getTime())
				.toZonedDateTimeISO(zone!)
				.toPlainDateTime()
				.with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
			let expected: Date | undefined;
			for (let i = 0; i < 10_080; i++) {
				candidate = candidate.add({ minutes: 1 });
				const day = cron.day.values.has(candidate.day);
				const weekday = cron.weekday.values.has(candidate.dayOfWeek % 7);
				if (
					!cron.month.values.has(candidate.month) ||
					!cron.hour.values.has(candidate.hour) ||
					!cron.minute.values.has(candidate.minute) ||
					!(cron.day.wildcard ? weekday : cron.weekday.wildcard ? day : day || weekday)
				)
					continue;
				const zoned = candidate.toZonedDateTime(zone!, { disambiguation: 'earlier' });
				if (
					zoned.toPlainDateTime().equals(candidate) &&
					Number(zoned.epochMilliseconds) > date.getTime()
				) {
					expected = new Date(Number(zoned.epochMilliseconds));
					break;
				}
			}
			expect(expected).toBeDefined();
			expect(nextCronOccurrence(expression!, date, zone!)).toEqual(expected!);
		}
	});
});
