import { expect, test } from 'bun:test';
import { moveBefore, sortByOrder } from './drag-order';

test('moves an item before another item', () => {
	expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
	expect(moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
});

test('orders known items first and preserves unknown item order', () => {
	expect(sortByOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a'], ({ id }) => id)).toEqual([
		{ id: 'c' },
		{ id: 'a' },
		{ id: 'b' }
	]);
});
