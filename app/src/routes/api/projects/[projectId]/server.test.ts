import { expect, mock, test } from 'bun:test';

const existing = {
	id: 'project-1',
	name: 'Original',
	rootPath: '/work/old',
	icon: null,
	createdAt: '2026-08-22T00:00:00.000Z'
};
const mutations: unknown[] = [];
const closedProjects: string[] = [];

mock.module('$lib/server/services', () => ({
	projectView: (project: typeof existing) => ({ ...project, rootAvailable: true }),
	trustedProjectRoot: (rootPath: string) => rootPath,
	services: () => ({
		store: {
			getProject: () => existing,
			relocateProject: (_id: string, rootPath: string) => {
				mutations.push({ relocate: rootPath });
				return { ...existing, rootPath };
			},
			updateProject: (_id: string, input: unknown) => {
				mutations.push(input);
				return { ...existing, ...(input as object) };
			},
			deleteProject: () => true
		},
		terminals: { closeProject: (projectId: string) => closedProjects.push(projectId) }
	})
}));

test('validates every Project PATCH field before any mutation', async () => {
	mutations.length = 0;
	closedProjects.length = 0;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-1' },
		request: new Request('http://localhost/api/projects/project-1', {
			method: 'PATCH',
			body: JSON.stringify({
				name: 'Renamed',
				icon: 'data:text/html;base64,PHNjcmlwdD4=',
				rootPath: '/work/new'
			})
		})
	} as never);

	expect(response.status).toBe(400);
	expect(mutations).toEqual([]);
	expect(closedProjects).toEqual([]);
});

test('applies name icon and root atomically before closing Project PTYs', async () => {
	mutations.length = 0;
	closedProjects.length = 0;
	const { PATCH } = await import('./+server');
	const response = await PATCH({
		params: { projectId: 'project-1' },
		request: new Request('http://localhost/api/projects/project-1', {
			method: 'PATCH',
			body: JSON.stringify({ name: 'Renamed', icon: '🚀', rootPath: '/work/new' })
		})
	} as never);

	expect(response.status).toBe(200);
	expect(mutations).toEqual([{ name: 'Renamed', icon: '🚀', rootPath: '/work/new' }]);
	expect(closedProjects).toEqual(['project-1']);
});

test('closes Project PTYs after removal', async () => {
	closedProjects.length = 0;
	const { DELETE } = await import('./+server');
	const response = await DELETE({ params: { projectId: 'project-1' } } as never);

	expect(response.status).toBe(200);
	expect(closedProjects).toEqual(['project-1']);
});
