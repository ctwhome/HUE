type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>;

const key = (projectId: string, panel: string) => `hue:project-tools:${projectId}:${panel}-open`;

export function readPanelState(
	storage: PanelStorage,
	projectId: string,
	panel: string,
	fallback: boolean
) {
	const saved = storage.getItem(key(projectId, panel));
	return saved === null ? fallback : saved === 'true';
}

export const readProjectPanels = (storage: PanelStorage, projectId: string) => ({
	browserOpen: projectId ? readPanelState(storage, projectId, 'browser', true) : true,
	terminalOpen: projectId ? readPanelState(storage, projectId, 'terminal', false) : false
});

export function togglePanelState(
	storage: PanelStorage,
	projectId: string,
	panel: string,
	current: boolean
) {
	const next = !current;
	storage.setItem(key(projectId, panel), String(next));
	return next;
}
