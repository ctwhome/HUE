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
	editingProject = $state<Project | null>(null);
	projectName = $state('');
	projectIcon = $state<string | null>(null);
	projectEmojiPickerOpen = $state(false);
	projectEditError = $state('');
	projectSaving = $state(false);
	locatingProject = $state<Project | null>(null);

	constructor(private options: ProjectManagementOptions) {
		this.projects = [...options.initialProjects];
	}

	openAddProject = () => {
		this.locatingProject = null;
		this.directoryError = '';
		this.addProjectDialog?.showModal();
		void this.loadDirectory();
	};

	openLocateProject = (project: Project) => {
		this.locatingProject = project;
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

	addProject = async (event: SubmitEvent) => {
		event.preventDefault();
		try {
			const body = this.locatingProject
				? await this.options.api<{ project: Project }>(`/api/projects/${this.locatingProject.id}`, {
						method: 'PATCH',
						body: JSON.stringify({ rootPath: this.projectRoot })
					})
				: await this.options.api<{ project: Project }>('/api/projects', {
						method: 'POST',
						body: JSON.stringify({ name: this.projectDirectoryName, rootPath: this.projectRoot })
					});
			this.projects = this.locatingProject
				? this.projects.map((project) => (project.id === body.project.id ? body.project : project))
				: [...this.projects, body.project];
			this.projectRoot = '';
			this.locatingProject = null;
			this.addProjectDialog?.close();
			await this.options.chooseProject(body.project);
		} catch (cause) {
			this.directoryError = cause instanceof Error ? cause.message : String(cause);
		}
	};

	openEditProject = (event: MouseEvent, project: Project) => {
		event.stopPropagation();
		this.editingProject = project;
		this.projectName = project.name;
		this.projectIcon = project.icon;
		this.projectEmojiPickerOpen = false;
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
					body: JSON.stringify({ name: this.projectName, icon: this.projectIcon })
				}
			);
			this.projects = this.projects.map((project) =>
				project.id === body.project.id ? body.project : project
			);
			if (this.options.getSelectedProject()?.id === body.project.id) {
				this.options.setSelectedProject(body.project);
			}
			this.editProjectDialog?.close();
		} catch (cause) {
			this.projectEditError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			this.projectSaving = false;
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
			this.removeProjectDialog?.close();
			this.projects = this.projects.filter((project) => project.id !== removedId);
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
}
