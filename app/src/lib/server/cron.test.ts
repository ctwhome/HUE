import { describe, expect, it } from 'bun:test';
import { nextCronOccurrence, parseCron } from './cron';

describe('five-field cron', () => {
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
});
