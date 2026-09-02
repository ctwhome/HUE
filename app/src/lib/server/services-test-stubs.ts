// Bun's module mocks are process-wide; every services mock must expose the full runtime surface.
export const serviceExportStubs = {
	services: () => ({}),
	unprojectedSessionRoot: () => '/tmp',
	quickAskSessionRoot: () => '/tmp/.quick-ask',
	trustedProjectRoot: (path: string) => path,
	projectView: (project: unknown) => project,
	loadProjectViews: async () => ({ projects: [], reconciliationIssues: [] }),
	authoritativeProject: async () => null,
	mergeProjectSessionViews: () => [],
	projectRuntimeHealth: () => ({ status: 'unavailable' }),
	sessionMatchesProjectRoot: () => false,
	sessionMatchesProjectFolders: () => false,
	projectBranch: () => null,
	projectRepository: () => ({}),
	projectRepositoryAction: () => ({})
};
