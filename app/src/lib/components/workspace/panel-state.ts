type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type ProjectPanel = 'browser' | 'excalidraw' | 'git' | 'files' | 'terminal';

const defaults: Record<ProjectPanel, boolean> = {
	browser: true,
	excalidraw: false,
	git: false,
	files: false,
	terminal: false
};

const key = (projectId: string, panel: ProjectPanel) =>
	`hue:project-tools:${projectId}:${panel}-open`;

export function readProjectPanels(
	storage: PanelStorage,
	projectId: string
): Record<ProjectPanel, boolean> {
	const panels = { ...defaults };
	if (!projectId) return panels;
	for (const panel of Object.keys(panels) as ProjectPanel[]) {
		const saved = storage.getItem(key(projectId, panel));
		if (saved !== null) panels[panel] = saved === 'true';
	}
	return panels;
}

export function togglePanelState(
	storage: PanelStorage,
	projectId: string,
	panel: ProjectPanel,
	current: boolean
): boolean {
	const next = !current;
	storage.setItem(key(projectId, panel), String(next));
	return next;
}
