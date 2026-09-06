type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type ProjectTool = 'browser' | 'git' | 'files' | 'terminal' | null;

const key = (projectId: string) => `hue:project-tools:${projectId}:active`;
const tools = new Set<ProjectTool>(['browser', 'git', 'files', 'terminal', null]);

export function readProjectTool(storage: PanelStorage, projectId: string): ProjectTool {
	const saved = storage.getItem(key(projectId));
	if (saved === null) return 'browser';
	return tools.has(saved as ProjectTool) ? (saved as ProjectTool) : null;
}

export function toggleProjectTool(
	storage: PanelStorage,
	projectId: string,
	tool: Exclude<ProjectTool, null>,
	current: ProjectTool
): ProjectTool {
	const next = current === tool ? null : tool;
	storage.setItem(key(projectId), next ?? 'closed');
	return next;
}
