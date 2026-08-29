export function moveBefore(order: string[], moved: string, before: string | null): string[] {
	const next = order.filter((id) => id !== moved);
	const index = before ? next.indexOf(before) : -1;
	if (index < 0) next.push(moved);
	else next.splice(index, 0, moved);
	return next;
}

export function moveBy(order: string[], moved: string, offset: -1 | 1): string[] {
	const index = order.indexOf(moved);
	const target = index + offset;
	if (index < 0 || target < 0 || target >= order.length) return order;
	const next = [...order];
	[next[index], next[target]] = [next[target]!, next[index]!];
	return next;
}

export function readStringArray(storage: Pick<Storage, 'getItem'>, key: string): string[] {
	try {
		const value = JSON.parse(storage.getItem(key) ?? '[]');
		return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
	} catch {
		return [];
	}
}

export function dropBefore(
	order: string[],
	moved: string,
	target: string,
	after: boolean
): string | null {
	if (!after) return target;
	const remaining = order.filter((id) => id !== moved);
	return remaining[remaining.indexOf(target) + 1] ?? null;
}

export function prependNew(order: string[], ids: string[]): string[] {
	const known = new Set(order);
	return [...ids.filter((id) => !known.has(id)), ...order];
}

export function sortByOrder<T>(items: T[], order: string[], key: (item: T) => string): T[] {
	const positions = new Map(order.map((id, index) => [id, index]));
	return items
		.map((item, index) => ({ item, index, position: positions.get(key(item)) }))
		.sort((a, b) =>
			a.position === undefined
				? b.position === undefined
					? a.index - b.index
					: 1
				: b.position === undefined
					? -1
					: a.position - b.position
		)
		.map(({ item }) => item);
}
