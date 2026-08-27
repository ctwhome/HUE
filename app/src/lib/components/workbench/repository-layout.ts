type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type RepositoryLayout = {
	gitOpen: boolean;
	worktreesOpen: boolean;
	selectedRepository: string;
	panelSizes: { git: number; worktrees: number; github: number };
};

const key = (projectId: string, name: string) => `hue:project-tools:${projectId}:${name}`;

export const defaultRepositoryLayout = (): RepositoryLayout => ({
	gitOpen: true,
	worktreesOpen: true,
	selectedRepository: '',
	panelSizes: { git: 1, worktrees: 1, github: 1 }
});

export function readRepositoryLayout(storage: LayoutStorage, projectId: string) {
	const layout = defaultRepositoryLayout();
	layout.gitOpen = storage.getItem(key(projectId, 'git-open')) !== 'false';
	layout.worktreesOpen = storage.getItem(key(projectId, 'worktrees-open')) !== 'false';
	layout.selectedRepository = storage.getItem(key(projectId, 'repository')) ?? '';
	try {
		const saved = JSON.parse(storage.getItem(key(projectId, 'panel-sizes')) ?? '{}');
		for (const name of ['git', 'worktrees', 'github'] as const) {
			if (typeof saved?.[name] === 'number' && Number.isFinite(saved[name]) && saved[name] > 0)
				layout.panelSizes[name] = saved[name];
		}
	} catch {
		// Defaults already represent a usable layout.
	}
	return layout;
}

export function toggleRepositoryPanel(
	storage: LayoutStorage,
	projectId: string,
	layout: RepositoryLayout,
	panel: 'git' | 'worktrees'
) {
	const field = panel === 'git' ? 'gitOpen' : 'worktreesOpen';
	layout[field] = !layout[field];
	storage.setItem(key(projectId, `${panel}-open`), String(layout[field]));
}

export function resizeRepositoryPanels(
	storage: LayoutStorage,
	projectId: string,
	layout: RepositoryLayout,
	first: 'git' | 'worktrees',
	second: 'worktrees' | 'github',
	firstSize: number,
	secondSize: number
) {
	layout.panelSizes[first] = firstSize;
	layout.panelSizes[second] = secondSize;
	storage.setItem(key(projectId, 'panel-sizes'), JSON.stringify(layout.panelSizes));
}

export function saveRepositorySelection(
	storage: LayoutStorage,
	projectId: string,
	selectedRepository: string
) {
	storage.setItem(key(projectId, 'repository'), selectedRepository);
}
