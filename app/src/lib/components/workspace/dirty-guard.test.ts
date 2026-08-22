import { expect, test } from 'bun:test';
import { DirtyGuard } from './dirty-guard';

test('central dirty guard queues one destructive navigation until accessible confirmation', () => {
	const guard = new DirtyGuard();
	let discarded = 0;
	let navigated = 0;
	const source = guard.register(() => discarded++);
	source.setDirty(true);

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

test('central dirty guard tracks and discards each registered dirty source', () => {
	const guard = new DirtyGuard();
	const discarded: string[] = [];
	const file = guard.register(() => discarded.push('file'));
	const skill = guard.register(() => discarded.push('skill'));

	file.setDirty(true);
	skill.setDirty(true);
	expect(guard.dirty).toBe(true);
	expect(guard.block(() => discarded.push('navigate'))).toBe(true);
	guard.discardAndContinue();

	expect(discarded).toEqual(['file', 'skill', 'navigate']);
	expect(guard.dirty).toBe(false);
	file.unregister();
	skill.unregister();
});

test('unregistering one dirty source preserves remaining dirty state', () => {
	const guard = new DirtyGuard();
	const file = guard.register(() => undefined);
	const skill = guard.register(() => undefined);
	file.setDirty(true);
	skill.setDirty(true);

	file.unregister();
	expect(guard.dirty).toBe(true);
	skill.setDirty(false);
	expect(guard.dirty).toBe(false);
});

test('central dirty guard does not intercept clean actions', () => {
	const guard = new DirtyGuard();
	expect(guard.block(() => undefined)).toBe(false);
	expect(guard.open).toBe(false);
});
