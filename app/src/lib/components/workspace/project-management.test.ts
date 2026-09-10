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
	it('keeps the newest icon file choice when two reads finish in selection order', async () => {
		const previous = globalThis.FileReader;
		const finishes: Array<() => void> = [];
		Object.assign(globalThis, {
			FileReader: class {
				result = '';
				onload?: () => void;
				readAsDataURL(file: { content: string }) {
					this.result = file.content;
					finishes.push(() => this.onload?.());
				}
			}
		});
		try {
			const state = manager(async <T>() => ({ project: original }) as T);
			state.editingProject = original;
			const read = (content: string) =>
				state.chooseProjectImage({
					currentTarget: { value: '', files: [{ type: 'image/png', size: 1, content }] }
				} as unknown as Event);
			const older = read('first');
			const newer = read('second');
			finishes[0]!();
			await older;
			finishes[1]!();
			await newer;
			expect(state.projectIcon).toBe('second');
		} finally {
			Object.assign(globalThis, { FileReader: previous });
		}
	});
	it('does not apply a delayed icon file to a different Project', async () => {
		const previous = globalThis.FileReader;
		let finish!: () => void;
		Object.assign(globalThis, {
			FileReader: class {
				result = 'data:image/png;base64,icon';
				onload?: () => void;
				readAsDataURL() {
					finish = () => this.onload?.();
				}
			}
		});
		try {
			let calls = 0;
			const state = manager(async <T>() => {
				calls++;
				return { project: original } as T;
			});
			state.editingProject = original;
			const reading = state.chooseProjectImage({
				currentTarget: { value: '', files: [{ type: 'image/png', size: 1 }] }
			} as unknown as Event);
			state.editingProject = { ...original, id: 'other' };
			state.projectIcon = 'Other icon';
			finish();
			await reading;
			expect(calls).toBe(0);
			expect(state.projectIcon).toBe('Other icon');
		} finally {
			Object.assign(globalThis, { FileReader: previous });
		}
	});
	it('keeps saving true until metadata and Project creation both settle', async () => {
		const create = deferred<{ project: Project }>();
		const update = deferred<{ project: Project }>();
		const state = manager(
			<T>(url: string) => (url === '/api/projects' ? create.promise : update.promise) as Promise<T>
		);
		state.projectName = 'New';
		state.selectedFolders = ['/work'];
		state.primaryFolder = '/work';
		const creating = state.createProject({ preventDefault() {} } as SubmitEvent);
		state.editingProject = original;
		const saving = state.saveProjectColor('blue');
		create.resolve({ project: { ...original, id: 'new' } });
		await creating;
		expect(state.projectSaving).toBe(true);
		update.resolve({ project: { ...original, color: 'blue' } });
		await saving;
		expect(state.projectSaving).toBe(false);
	});
	it('keeps newer group typing while a metadata save settles', async () => {
		const response = deferred<{ project: Project }>();
		const state = manager(<T>() => response.promise as Promise<T>);
		state.editingProject = original;
		const saving = state.saveProjectGroup('Submitted');
		state.projectGroup = 'Still typing';
		response.resolve({ project: { ...original, group: 'Submitted' } });
		await saving;
		expect(state.projects[0].group).toBe('Submitted');
		expect(state.projectGroup).toBe('Still typing');
	});

	it('does not let an older metadata failure replace a newly opened Project error', async () => {
		let reject!: (cause: unknown) => void;
		const state = manager(
			<T>() =>
				new Promise<T>((_, fail) => {
					reject = fail;
				})
		);
		state.editingProject = original;
		const saving = state.saveProjectGroup('Submitted');
		state.editingProject = { ...original, id: 'other' };
		state.projectEditError = 'Other Project error';
		reject(new Error('Old Project failure'));
		await saving;
		expect(state.projectEditError).toBe('Other Project error');
	});
	it('does not let an older refresh revert metadata and synchronizes selected Project', async () => {
		const read = deferred<{ projects: Project[] }>();
		let selected = original;
		const state = new ProjectManagement({
			initialProjects: [original],
			api: (<T>(url: string) =>
				url === '/api/projects'
					? read.promise
					: Promise.resolve({ project: { ...original, color: 'blue' } })) as never,
			getSelectedProject: () => selected,
			setSelectedProject: (project) => {
				selected = project;
			},
			chooseProject: async () => {}
		});
		state.editingProject = original;
		const refreshing = state.refreshProjects();
		await state.saveProjectColor('blue');
		read.resolve({ projects: [original] });
		await refreshing;
		expect(state.projects[0].color).toBe('blue');
		expect(selected.color).toBe('blue');
	});

	it('orders color and group readbacks with shared pending state', async () => {
		const first = deferred<{ project: Project }>();
		const second = deferred<{ project: Project }>();
		let call = 0;
		const state = manager(<T>() => (++call === 1 ? first.promise : second.promise) as Promise<T>);
		state.editingProject = original;
		const color = state.saveProjectColor('blue');
		const group = state.saveProjectGroup('New');
		second.resolve({ project: { ...original, color: 'blue', group: 'New' } });
		await group;
		expect(state.projectSaving).toBe(true);
		first.resolve({ project: { ...original, color: 'blue' } });
		await color;
		expect(state.projects[0].group).toBe('New');
		expect(state.projectSaving).toBe(false);
	});

	it('refreshes selected Project metadata along with the list', async () => {
		let selected = original;
		const updated = { ...original, name: 'Updated' };
		const state = new ProjectManagement({
			initialProjects: [original],
			api: async <T>() => ({ projects: [updated] }) as T,
			getSelectedProject: () => selected,
			setSelectedProject: (project) => {
				selected = project;
			},
			chooseProject: async () => {}
		});
		await state.refreshProjects();
		expect(selected.name).toBe('Updated');
	});
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

		expect(requests[0]).toMatchObject({
			url: '/api/directories/pick',
			options: { method: 'POST' }
		});
		expect(requests[0]?.options?.signal).toBeInstanceOf(AbortSignal);
		expect(state.selectedFolders).toEqual(['/work/new-project']);
		expect(state.primaryFolder).toBe('/work/new-project');
		expect(state.projectName).toBe('new-project');
	});

	it('recovers when the system folder picker times out', async () => {
		const state = manager(async () => {
			throw new DOMException('Timed out', 'TimeoutError');
		});

		await state.pickFolder();

		expect(state.directoryLoading).toBe(false);
		expect(state.directoryError).toBe('The folder chooser did not respond. Try again.');
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
