import type { FileEntry } from './file-types';

export type TreeKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'ArrowLeft' | 'ArrowRight';
export type TreeKeyboardAction = {
	focusPath: string;
	expand?: string;
	collapse?: string;
};

export function visibleFileEntries(entries: FileEntry[], expanded: ReadonlySet<string>) {
	return entries.filter((entry) => {
		const parts = entry.path.split('/');
		return parts
			.slice(0, -1)
			.every((_, index) => expanded.has(parts.slice(0, index + 1).join('/')));
	});
}

export function restoreTreeFocus(
	entries: FileEntry[],
	expanded: ReadonlySet<string>,
	path: string
) {
	const visible = visibleFileEntries(entries, expanded);
	if (visible.some((entry) => entry.path === path)) return path;
	const parts = path.split('/');
	while (parts.length > 1) {
		parts.pop();
		const parent = parts.join('/');
		if (visible.some((entry) => entry.path === parent)) return parent;
	}
	return visible[0]?.path ?? '';
}

export function treeKeyboardAction(
	entries: FileEntry[],
	expanded: ReadonlySet<string>,
	path: string,
	key: TreeKey
): TreeKeyboardAction {
	const visible = visibleFileEntries(entries, expanded);
	const index = Math.max(
		0,
		visible.findIndex((entry) => entry.path === path)
	);
	const current = visible[index];
	if (key === 'Home') return { focusPath: visible[0]?.path ?? path };
	if (key === 'End') return { focusPath: visible.at(-1)?.path ?? path };
	if (key === 'ArrowUp') return { focusPath: visible[Math.max(0, index - 1)]?.path ?? path };
	if (key === 'ArrowDown')
		return { focusPath: visible[Math.min(visible.length - 1, index + 1)]?.path ?? path };
	if (key === 'ArrowRight' && current?.type === 'directory') {
		if (!expanded.has(path)) return { focusPath: path, expand: path };
		const child = visible.find((entry) => entry.path.startsWith(`${path}/`));
		return { focusPath: child?.path ?? path };
	}
	if (key === 'ArrowLeft') {
		if (current?.type === 'directory' && expanded.has(path))
			return { focusPath: path, collapse: path };
		return { focusPath: path.split('/').slice(0, -1).join('/') || path };
	}
	return { focusPath: path };
}
