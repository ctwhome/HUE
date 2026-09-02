import { describe, expect, it } from 'bun:test';
import type { Project } from './types';

Object.assign(globalThis, { $state: <T>(value?: T) => value });
const { ProjectManagement } = await import('./project-management.svelte');

const original: Project = {
	id: 'p_1',
	name: 'HUE',
	icon: null,
	color: null,
	group: null,
	primaryPath: '/work/app',
	rootAvailable: true,
	sessionCount: 0,
	folders: [
		{ path: '/work/app', label: null, isPrimary: true, available: true },
		{ path: '/work/docs', label: 'Docs', isPrimary: false, available: true }
	]
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function manager(api: <T>(url: string, options?: RequestInit) => Promise<T>) {
	return new ProjectManagement({
		initialProjects: [original],
		api,
		getSelectedProject: () => original,
		setSelectedProject: () => undefined,
		chooseProject: async () => undefined
	});
}

describe('ProjectManagement Hermes authority', () => {
	it('asks the server to discover the automatic Project icon', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: original } as T;
		});
		state.editingProject = original;

		await state.saveProjectIcon(null);

		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({ action: 'auto_icon' });
	});

	it('persists the selected status color in HUE metadata', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const colored = { ...original, color: '#7aa2f7' };
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: colored } as T;
		});
		state.editingProject = original;

		await state.saveProjectColor('#7aa2f7');

		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			action: 'set_color',
			color: '#7aa2f7'
		});
		expect(state.projects[0].color).toBe('#7aa2f7');
	});

	it('persists a trimmed group label in HUE metadata', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const grouped = { ...original, group: 'Client work' };
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: grouped } as T;
		});
		state.editingProject = original;

		await state.saveProjectGroup('  Client work  ');

		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			action: 'set_group',
			group: 'Client work'
		});
		expect(state.projects[0].group).toBe('Client work');
	});

	it('creates a section by assigning the chosen Projects', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const grouped = { ...original, group: 'Topics' };
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: grouped } as T;
		});

		await state.createProjectSection('  Topics  ', ['p_1']);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe('/api/projects/p_1');
		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			action: 'set_group',
			group: 'Topics'
		});
		expect(state.projects[0].group).toBe('Topics');
	});

	it('moves a Project out of a section', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: original } as T;
		});

		await state.moveProjectToSection('p_1', null);

		expect(requests[0]?.url).toBe('/api/projects/p_1');
		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			action: 'set_group',
			group: null
		});
	});

	it('creates one Project with every selected folder and exactly one primary', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { project: original } as T;
		});
		state.projectName = 'Workspace';
		state.projectIcon = '📚';
		state.projectColor = '#7aa2f7';
		state.projectGroup = 'Writing';
		state.selectedFolders = ['/work/app', '/work/docs'];
		state.primaryFolder = '/work/docs';

		await state.createProject({ preventDefault() {} } as SubmitEvent);

		expect(requests[0]?.url).toBe('/api/projects');
		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			name: 'Workspace',
			icon: '📚',
			color: '#7aa2f7',
			group: 'Writing',
			folders: ['/work/app', '/work/docs'],
			primaryPath: '/work/docs'
		});
	});

	it('opens the system folder picker and selects its result', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return { path: '/work/new-project', name: 'new-project' } as T;
		});

		await state.pickFolder();

		expect(requests[0]).toMatchObject({ url: '/api/directories/pick', options: { method: 'POST' } });
		expect(state.selectedFolders).toEqual(['/work/new-project']);
		expect(state.primaryFolder).toBe('/work/new-project');
		expect(state.projectName).toBe('new-project');
	});

	it('creates a folder in the open directory and refreshes the browser', async () => {
		const requests: Array<{ url: string; options?: RequestInit }> = [];
		const state = manager(async <T>(url: string, options?: RequestInit) => {
			requests.push({ url, options });
			return {
				path: '/work/app',
				name: 'app',
				parent: '/work',
				entries: [{ name: 'New project', path: '/work/app/New project' }]
			} as T;
		});
		state.projectRoot = '/work/app';

		await state.createDirectory('New project');

		expect(requests[0]?.url).toBe('/api/directories');
		expect(requests[0]?.options?.method).toBe('POST');
		expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
			parent: '/work/app',
			name: 'New project',
			hidden: false
		});
		expect(state.projectDirectories).toEqual([
			{ name: 'New project', path: '/work/app/New project' }
		]);
	});

	it('ignores stale out-of-order Project list responses', async () => {
		const first = deferred<{ projects: Project[] }>();
		const second = deferred<{ projects: Project[] }>();
		let call = 0;
		const state = manager(<T>() => (++call === 1 ? first.promise : second.promise) as Promise<T>);
		const refreshA = state.refreshProjects();
		const refreshB = state.refreshProjects();
		const newest = { ...original, id: 'p_newest', name: 'Newest' };
		second.resolve({ projects: [newest] });
		await refreshB;
		first.resolve({ projects: [{ ...original, id: 'p_stale', name: 'Stale' }] });
		await refreshA;

		expect(state.projects.map(({ id }) => id)).toEqual(['p_newest']);
	});

	it('rolls failed primary mutation back to authoritative readback visibly', async () => {
		const state = manager(async () => {
			const cause = Object.assign(new Error('Hermes write failed'), { project: original });
			throw cause;
		});

		const pending = state.setPrimaryFolder(original, '/work/docs');
		expect(state.projects[0].primaryPath).toBe('/work/docs');
		await pending;

		expect(state.projects[0]).toEqual(original);
		expect(state.projectEditError).toContain('Restored Hermes state');
	});

	it('shows reconciliation warning instead of claiming failed restoration', async () => {
		const partial = {
			...original,
			primaryPath: '/work/docs',
			folders: original.folders.map((folder) => ({
				...folder,
				isPrimary: folder.path === '/work/docs'
			}))
		};
		const state = manager(async () => {
			const cause = Object.assign(new Error('Removal failed; reconciliation required'), {
				project: partial,
				reconciliationRequired: true
			});
			throw cause;
		});

		await state.setPrimaryFolder(original, '/work/docs');

		expect(state.projects[0]).toEqual(partial);
		expect(state.projectEditError).toContain('reconciliation required');
		expect(state.projectEditError).not.toContain('Restored Hermes state');
	});

	it('ignores stale Project mutation readback after a newer mutation wins', async () => {
		const first = deferred<{ project: Project }>();
		const second = deferred<{ project: Project }>();
		let call = 0;
		const state = manager(<T>() => (++call === 1 ? first.promise : second.promise) as Promise<T>);
		const docsPrimary: Project = {
			...original,
			primaryPath: '/work/docs',
			folders: original.folders.map((folder) => ({
				...folder,
				isPrimary: folder.path === '/work/docs'
			}))
		};

		const older = state.setPrimaryFolder(original, '/work/docs');
		const newer = state.setPrimaryFolder(docsPrimary, '/work/app');
		second.resolve({ project: original });
		await newer;
		first.resolve({ project: docsPrimary });
		await older;

		expect(state.projects[0].primaryPath).toBe('/work/app');
	});
});
