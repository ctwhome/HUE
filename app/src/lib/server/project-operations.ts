type ProjectState = { id: string; archived: boolean };

type ProjectOperationDependencies<Project extends ProjectState> = {
	resolve(reference: string): Promise<Project>;
	active(projectId: string): boolean;
	archive(projectId: string): Promise<Project>;
};

export class ProjectOperations<Project extends ProjectState = ProjectState> {
	private readonly locks = new Map<string, Promise<void>>();

	constructor(private readonly dependencies: ProjectOperationDependencies<Project>) {}

	get size() {
		return this.locks.size;
	}

	async message<T>(reference: string, submit: (project: Project) => Promise<T> | T): Promise<T> {
		return this.withProject(reference, submit);
	}

	async archive(reference: string): Promise<Project> {
		return this.withProject(reference, async (project) => {
			if (this.dependencies.active(project.id)) {
				throw new Error('Project has active message deliveries');
			}
			return this.dependencies.archive(project.id);
		});
	}

	private async withProject<T>(
		reference: string,
		operation: (project: Project) => Promise<T> | T
	): Promise<T> {
		const initial = await this.dependencies.resolve(reference);
		return this.exclusive(initial.id, async () => {
			const project = await this.dependencies.resolve(initial.id);
			if (project.archived) throw new Error('Project not found');
			return operation(project);
		});
	}

	private exclusive<T>(projectId: string, operation: () => Promise<T> | T): Promise<T> {
		const preceding = this.locks.get(projectId) ?? Promise.resolve();
		const pending = preceding.then(operation);
		const tail = pending.then(
			() => undefined,
			() => undefined
		);
		this.locks.set(projectId, tail);
		void tail.finally(() => {
			if (this.locks.get(projectId) === tail) this.locks.delete(projectId);
		});
		return pending;
	}
}
