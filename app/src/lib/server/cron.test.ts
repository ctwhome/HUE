import { describe, expect, it } from 'bun:test';
import { nextCronOccurrence, parseCron } from './cron';

describe('five-field cron', () => {
	it('supports wildcards, values, lists, ranges, steps, and Sunday 0 or 7', () => {
		expect(parseCron('*/15 9-10 * * 0,7')).toBeTruthy();
		expect(nextCronOccurrence('*/15 9-10 * * 0,7', new Date(2026, 7, 29, 10, 59))).toEqual(
			new Date(2026, 7, 30, 9, 0)
		);
	});

	it('uses standard day-of-month or day-of-week matching and rejects invalid expressions', () => {
		expect(nextCronOccurrence('0 9 1 * 1', new Date(2026, 7, 31, 9, 0))).toEqual(
			new Date(2026, 8, 1, 9, 0)
		);
		expect(() => parseCron('0 24 * * *')).toThrow('Invalid cron hour');
		expect(() => parseCron('* * * *')).toThrow('five fields');
		expect(() => parseCron('-1 * * * *')).toThrow('Invalid cron minute');
		expect(() => parseCron('1- * * * *')).toThrow('Invalid cron minute');
	});

	it('treats stepped day fields as wildcards for standard day matching', () => {
		expect(nextCronOccurrence('0 9 */2 * 1', new Date(2026, 7, 31, 9, 0))).toEqual(
			new Date(2026, 8, 7, 9, 0)
		);
	});
});
