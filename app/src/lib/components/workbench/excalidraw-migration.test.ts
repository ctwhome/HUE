import { expect, test } from 'bun:test';
import { browserCanvasAddressKey, browserCanvasStorageKey } from './browser-canvas';
import { migrateLegacyExcalidraw } from './excalidraw-migration';

function memoryStorage(entries: Record<string, string>): Storage {
	const values = new Map(Object.entries(entries));
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => void values.delete(key),
		setItem: (key, value) => void values.set(key, value)
	};
}

test('moves valid legacy Excalidraw state to SQLite before removing browser keys', async () => {
	const projectId = 'project-1';
	const storage = memoryStorage({
		[browserCanvasAddressKey(projectId)]: 'example.com',
		[browserCanvasStorageKey(projectId)]: '{"version":1,"elements":[],"appState":{}}'
	});
	let persisted: { address?: string; scene?: string } | undefined;

	const state = await migrateLegacyExcalidraw(
		projectId,
		async (input) => {
			persisted = input;
			return {
				projectId,
				address: input.address ?? '',
				scene: input.scene ?? '',
				updatedAt: 'now'
			};
		},
		storage
	);

	expect(persisted).toEqual({
		address: 'http://example.com/',
		scene: '{"version":1,"elements":[],"appState":{}}'
	});
	expect(state?.projectId).toBe(projectId);
	expect(storage.length).toBe(0);
});

test('keeps legacy keys when the server save fails', async () => {
	const projectId = 'project-1';
	const storage = memoryStorage({
		[browserCanvasStorageKey(projectId)]: '{"version":1,"elements":[],"appState":{}}'
	});

	await expect(
		migrateLegacyExcalidraw(
			projectId,
			async () => {
				throw new Error('offline');
			},
			storage
		)
	).rejects.toThrow('offline');
	expect(storage.length).toBe(1);
});
