import { tick } from 'svelte';
import type { Api, Directory, DirectoryListing, Project } from './types';

type ProjectManagementOptions = {
	initialProjects: Project[];
	api: Api;
	getSelectedProject: () => Project | null;
	setSelectedProject: (project: Project) => void;
	chooseProject: (project: Project | null) => Promise<void>;
};

export function isImageIcon(icon: string | null): boolean {
	return icon?.startsWith('data:image/') ?? false;
}

async function imageDataUrl(file: File): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

function errorProject(cause: unknown): Project | null {
	const project = (cause as { project?: unknown } | null)?.project;
	return project && typeof project === 'object' && typeof (project as Project).id === 'string'
		? (project as Project)
		: null;
}

export class ProjectManagement {
	projects = $state<Project[]>([]);
	projectRoot = $state('');
	projectDirectoryName = $state('');
	projectDirectories = $state<Directory[]>([]);
	projectDirectoryParent = $state<string | null>(null);
	showHiddenDirectories = $state(false);
	directoryLoading = $state(false);
	directoryError = $state('');
	addProjectDialog = $state<HTMLDialogElement>();
	editProjectDialog = $state<HTMLDialogElement>();
	removeProjectDialog = $state<HTMLDialogElement>();
	projectIconPopover = $state<HTMLElement>();
	projectSettingsIconPopover = $state<HTMLElement>();
	projectIconAnchor = $state<HTMLElement>();
	editingProject = $state<Project | null>(null);
	projectName = $state('');
	projectIcon = $state<string | null>(null);
	projectEditError = $state('');
	projectSaving = $state(false);
	locatingProject = $state<Project | null>(null);
	selectedFolders = $state<string[]>([]);
	primaryFolder = $state('');
	private refreshGeneration = 0;
	private mutationGeneration = new Map<string, number>();
	private pendingMutations = 0;

	constructor(private options: ProjectManagementOptions) {
		this.projects = [...options.initialProjects];
	}

	openAddProject = () => {
		this.locatingProject = null;
		this.projectName = '';
		this.selectedFolders = [];
		this.primaryFolder = '';
		this.directoryError = '';
		this.addProjectDialog?.showModal();
		void this.loadDirectory();
	};

	openLocateProject = (project: Project) => {
		this.locatingProject = project;
		this.editingProject = project;
		this.directoryError = '';
		this.addProjectDialog?.showModal();
		void this.loadDirectory();
	};

	loadDirectory = async (path?: string, showHidden = this.showHiddenDirectories) => {
		this.directoryLoading = true;
		this.directoryError = '';
		try {
			const query = new URLSearchParams({ hidden: String(showHidden) });
			if (path) query.set('path', path);
			const directory = await this.options.api<DirectoryListing>(`/api/directories?${query}`);
			this.projectRoot = directory.path;
			this.projectDirectoryName = directory.name;
			this.projectDirectoryParent = directory.parent;
			this.projectDirectories = directory.entries;
			this.directoryLoading = false;
			await tick();
			this.addProjectDialog
				?.querySelector<HTMLButtonElement>('.directory-row, .add-project button')
				?.focus();
		} catch (cause) {
			this.directoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.directoryLoading = false;
		}
	};

	toggleHiddenDirectories = (event: Event) => {
		this.showHiddenDirectories = (event.currentTarget as HTMLInputElement).checked;
		void this.loadDirectory(this.projectRoot, this.showHiddenDirectories);
	};

	toggleSelectedFolder = (path = this.projectRoot) => {
		if (!path) return;
		if (this.selectedFolders.includes(path)) {
			this.selectedFolders = this.selectedFolders.filter((folder) => folder !== path);
			if (this.primaryFolder === path) this.primaryFolder = this.selectedFolders[0] ?? '';
		} else {
			this.selectedFolders = [...this.selectedFolders, path];
			if (!this.primaryFolder) this.primaryFolder = path;
			if (!this.projectName) this.projectName = this.projectDirectoryName;
		}
	};

	choosePrimaryFolder = (path: string) => {
		if (this.selectedFolders.includes(path)) this.primaryFolder = path;
	};

	createProject = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!this.projectName.trim() || !this.selectedFolders.length || !this.primaryFolder) return;
		this.projectSaving = true;
		this.directoryError = '';
		try {
			const body = await this.options.api<{ project: Project }>('/api/projects', {
				method: 'POST',
				body: JSON.stringify({
					name: this.projectName.trim(),
					folders: this.selectedFolders,
					primaryPath: this.primaryFolder
				})
			});
			this.projects = [...this.projects, body.project];
			this.addProjectDialog?.close();
			await this.options.chooseProject(body.project);
		} catch (cause) {
			this.directoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.projectSaving = false;
		}
	};

	addProject = this.createProject;

	addCurrentFolder = async () => {
		if (!this.locatingProject || !this.projectRoot) return;
		await this.mutateProject(
			this.locatingProject,
			this.locatingProject,
			{
				action: 'add_folder',
				path: this.projectRoot,
				isPrimary: false
			},
			this.directoryErrorSetter
		);
		if (!this.directoryError) this.addProjectDialog?.close();
	};

	openEditProject = (event: MouseEvent | null, project: Project) => {
		event?.stopPropagation();
		this.editingProject = project;
		this.projectName = project.name;
		this.projectIcon = project.icon;
		this.projectEditError = '';
		this.editProjectDialog?.showModal();
	};

	chooseProjectImage = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
			this.projectEditError = 'Only PNG, JPEG, GIF, and WebP images are supported';
			return;
		}
		if (file.size > 1024 * 1024) {
			this.projectEditError = 'Project icon image must be 1 MB or smaller';
			return;
		}
		this.projectIcon = await imageDataUrl(file);
		this.projectEditError = '';
		await this.saveProjectIcon(this.projectIcon);
	};

	openProjectIcon = (event: MouseEvent, project: Project) => {
		event.stopPropagation();
		this.projectIconAnchor = event.currentTarget as HTMLElement;
		if (this.editingProject?.id !== project.id) {
			this.editingProject = project;
			this.projectName = project.name;
			this.projectIcon = project.icon;
		}
		const insideSettings = (event.currentTarget as HTMLElement).closest('dialog');
		(insideSettings ? this.projectSettingsIconPopover : this.projectIconPopover)?.showPopover();
	};

	saveProjectIcon = async (icon: string | null) => {
		if (!this.editingProject) return;
		this.projectIcon = icon;
		this.projectSaving = true;
		this.projectEditError = '';
		try {
			const body = await this.options.api<{ project: Project }>(
				`/api/projects/${this.editingProject.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify(
						icon === null
							? { action: 'auto_icon' }
							: { action: 'update', name: this.editingProject.name, icon }
					)
				}
			);
			this.applyProject(body.project);
		} catch (cause) {
			this.restoreProject(cause);
			this.projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.projectSaving = false;
		}
	};

	saveProject = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!this.editingProject) return;
		this.projectSaving = true;
		this.projectEditError = '';
		try {
			const body = await this.options.api<{ project: Project }>(
				`/api/projects/${this.editingProject.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({
						action: 'update',
						name: this.projectName,
						icon: this.projectIcon
					})
				}
			);
			this.applyProject(body.project);
			this.editProjectDialog?.close();
		} catch (cause) {
			this.restoreProject(cause);
			this.projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.projectSaving = false;
		}
	};

	setPrimaryFolder = async (project: Project, path: string) => {
		const optimistic: Project = {
			...project,
			primaryPath: path,
			rootAvailable: project.folders.find((folder) => folder.path === path)?.available ?? false,
			folders: project.folders.map((folder) => ({ ...folder, isPrimary: folder.path === path }))
		};
		await this.mutateProject(project, optimistic, { action: 'set_primary', path });
	};

	removeFolder = async (project: Project, path: string) => {
		const folder = project.folders.find((item) => item.path === path);
		if (!folder || folder.isPrimary || project.folders.length === 1) return;
		await this.mutateProject(
			project,
			{ ...project, folders: project.folders.filter((item) => item.path !== path) },
			{ action: 'remove_folder', path }
		);
	};

	setFolderLabel = async (project: Project, path: string, label: string) => {
		await this.mutateProject(project, project, {
			action: 'add_folder',
			path,
			label,
			isPrimary: false
		});
	};

	refreshProjects = async () => {
		const generation = ++this.refreshGeneration;
		try {
			const body = await this.options.api<{ projects: Project[] }>('/api/projects');
			if (generation === this.refreshGeneration) this.projects = body.projects;
		} catch (cause) {
			if (generation === this.refreshGeneration) {
				this.projectEditError = cause instanceof Error ? cause.message : String(cause);
			}
		}
	};

	requestRemoveProject = () => {
		this.projectEditError = '';
		if (this.editingProject) this.removeProjectDialog?.showModal();
	};

	requestRemoveStaleProject = (project: Project) => {
		this.editingProject = project;
		this.projectEditError = '';
		this.removeProjectDialog?.showModal();
	};

	removeProject = async () => {
		if (!this.editingProject) return;
		this.projectSaving = true;
		this.projectEditError = '';
		try {
			const removedId = this.editingProject.id;
			await this.options.api(`/api/projects/${removedId}`, { method: 'DELETE' });
			this.projects = this.projects.filter((project) => project.id !== removedId);
			this.removeProjectDialog?.close();
			this.editProjectDialog?.close();
			if (this.options.getSelectedProject()?.id === removedId) {
				await this.options.chooseProject(
					this.projects.find(({ rootAvailable }) => rootAvailable) ?? null
				);
			}
		} catch (cause) {
			this.projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.projectSaving = false;
		}
	};

	private directoryErrorSetter = (message: string) => (this.directoryError = message);

	private async mutateProject(
		project: Project,
		optimistic: Project,
		payload: Record<string, unknown>,
		setError: (message: string) => void = (message) => (this.projectEditError = message)
	) {
		const generation = (this.mutationGeneration.get(project.id) ?? 0) + 1;
		this.mutationGeneration.set(project.id, generation);
		this.applyProject(optimistic);
		this.pendingMutations += 1;
		this.projectSaving = true;
		setError('');
		try {
			const body = await this.options.api<{ project: Project }>(`/api/projects/${project.id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload)
			});
			if (this.mutationGeneration.get(project.id) === generation) this.applyProject(body.project);
		} catch (cause) {
			if (this.mutationGeneration.get(project.id) !== generation) return;
			const restored = this.restoreProject(cause) ?? project;
			this.applyProject(restored);
			const message = cause instanceof Error ? cause.message : String(cause);
			setError(
				(cause as { reconciliationRequired?: unknown } | null)?.reconciliationRequired === true
					? message
					: `${message}. Restored Hermes state.`
			);
		} finally {
			this.pendingMutations -= 1;
			this.projectSaving = this.pendingMutations > 0;
		}
	}

	private applyProject(project: Project) {
		this.projects = this.projects.map((item) => (item.id === project.id ? project : item));
		if (this.options.getSelectedProject()?.id === project.id) {
			this.options.setSelectedProject(project);
		}
		if (this.editingProject?.id === project.id) this.editingProject = project;
	}

	private restoreProject(cause: unknown) {
		const project = errorProject(cause);
		if (project) this.applyProject(project);
		return project;
	}
}
