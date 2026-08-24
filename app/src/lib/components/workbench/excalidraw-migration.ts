import {
	browserCanvasAddressKey,
	browserCanvasStorageKey,
	parseStoredBrowserAddress,
	parseStoredBrowserScene,
	serializeBrowserScene
} from './browser-canvas';

export type ProjectExcalidrawState = {
	projectId: string;
	address: string;
	scene: string;
	updatedAt: string;
};

export async function migrateLegacyExcalidraw(
	projectId: string,
	persist: (input: { address?: string; scene?: string }) => Promise<ProjectExcalidrawState>,
	storage: Storage = localStorage
): Promise<ProjectExcalidrawState | null> {
	const addressKey = browserCanvasAddressKey(projectId);
	const sceneKey = browserCanvasStorageKey(projectId);
	const address = parseStoredBrowserAddress(storage.getItem(addressKey));
	const parsedScene = parseStoredBrowserScene(storage.getItem(sceneKey));
	const input = {
		...(address ? { address } : {}),
		...(parsedScene
			? { scene: serializeBrowserScene(parsedScene.elements, parsedScene.appState) }
			: {})
	};
	if (!input.address && !input.scene) return null;
	const state = await persist(input);
	storage.removeItem(addressKey);
	storage.removeItem(sceneKey);
	return state;
}
