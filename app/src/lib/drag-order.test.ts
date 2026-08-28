import { expect, test } from 'bun:test';
import { dropBefore, moveBefore, prependNew, sortByOrder } from './drag-order';

test('moves an item before another item', () => {
	expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
	expect(moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
});

test('resolves row drop position above or below the target', () => {
	expect(dropBefore(['a', 'b', 'c'], 'a', 'b', false)).toBe('b');
	expect(dropBefore(['a', 'b', 'c'], 'a', 'b', true)).toBe('c');
	expect(dropBefore(['a', 'b', 'c'], 'a', 'c', true)).toBeNull();
});

test('orders known items first and preserves unknown item order', () => {
	expect(sortByOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a'], ({ id }) => id)).toEqual([
		{ id: 'c' },
		{ id: 'a' },
		{ id: 'b' }
	]);
});

test('prepends new items without disturbing the saved order', () => {
	expect(prependNew(['b', 'a'], ['c', 'a', 'b'])).toEqual(['c', 'b', 'a']);
});
