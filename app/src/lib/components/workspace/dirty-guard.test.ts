import { expect, test } from 'bun:test';
import { DirtyGuard } from './dirty-guard';

test('central dirty guard queues one destructive navigation until accessible confirmation', () => {
	const guard = new DirtyGuard();
	let discarded = 0;
	let navigated = 0;
	guard.register(() => discarded++);
	guard.setDirty(true);

	expect(guard.block(() => navigated++)).toBe(true);
	expect(guard.open).toBe(true);
	expect(navigated).toBe(0);
	guard.keepEditing();
	expect(guard.open).toBe(false);
	expect(navigated).toBe(0);

	expect(guard.block(() => navigated++)).toBe(true);
	guard.discardAndContinue();
	expect(discarded).toBe(1);
	expect(navigated).toBe(1);
	expect(guard.dirty).toBe(false);
});

test('central dirty guard does not intercept clean actions', () => {
	const guard = new DirtyGuard();
	expect(guard.block(() => undefined)).toBe(false);
	expect(guard.open).toBe(false);
});
