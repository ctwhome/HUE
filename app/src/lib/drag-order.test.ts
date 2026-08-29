import { expect, test } from 'bun:test';
import {
	dropBefore,
	moveBefore,
	moveBy,
	prependNew,
	readStringArray,
	sortByOrder
} from './drag-order';

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

test('moves an item one position for keyboard reordering and stops at the ends', () => {
	expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
	expect(moveBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
	expect(moveBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
	expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
});

test('reads only string arrays from browser storage', () => {
	const values = new Map([
		['valid', '["a","b"]'],
		['mixed', '["a",2]'],
		['invalid', '{']
	]);
	const storage = { getItem: (key: string) => values.get(key) ?? null };

	expect(readStringArray(storage, 'valid')).toEqual(['a', 'b']);
	expect(readStringArray(storage, 'mixed')).toEqual([]);
	expect(readStringArray(storage, 'invalid')).toEqual([]);
	expect(readStringArray(storage, 'missing')).toEqual([]);
});
