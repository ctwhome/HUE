import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { HermesProjectsRpcError } from './hermes-projects-rpc';

export type HermesProjectFolder = {
	path: string;
	label: string | null;
	is_primary: boolean;
	added_at: number;
};

export type HermesProject = {
	id: string;
	name: string;
	icon: string | null;
	primary_path: string;
	folders: HermesProjectFolder[];
	archived: boolean;
};

type ProjectsTransport = {
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
};

export class HermesProjectsCapabilityError extends Error {
	readonly capabilityMissing = true;

	constructor() {
		super(
			'Hermes Projects unavailable. Upgrade Hermes to a runtime with projects.* RPC, then retry.'
		);
		this.name = 'HermesProjectsCapabilityError';
	}
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
		throw new Error(`Hermes returned an invalid Project ${label}`);
	}
	return value;
}

function path(value: unknown): string {
	const candidate = text(value, 'folder');
	if (!isAbsolute(candidate)) throw new Error('Hermes returned a non-absolute Project folder');
	return candidate;
}

function canonicalIfAvailable(folderPath: string): string | null {
	try {
		return realpathSync(resolve(folderPath));
	} catch {
		return null;
	}
}

function rawFolder(project: HermesProject, folderPath: string, excluded?: string): string {
	const selectedRaw = resolve(folderPath);
	const selectedCanonical = canonicalIfAvailable(folderPath);
	const matches = project.folders.filter(
		(folder) =>
			folder.path !== excluded &&
			(resolve(folder.path) === selectedRaw ||
				(selectedCanonical !== null && canonicalIfAvailable(folder.path) === selectedCanonical))
	);
	if (matches.length > 1) throw new Error('Hermes returned a duplicate canonical Project folder');
	if (!matches.length) throw new Error('Folder does not belong to Project');
	return matches[0].path;
}

export class HermesProjectMutationError extends Error {
	constructor(
		message: string,
		readonly project: HermesProject,
		readonly restored: boolean,
		readonly reconciliationRequired = !restored
	) {
		super(message);
		this.name = 'HermesProjectMutationError';
	}
}

function normalizeProject(value: unknown): HermesProject {
	if (!value || typeof value !== 'object') throw new Error('Hermes returned an invalid Project');
	const raw = value as Record<string, unknown>;
	if (!Array.isArray(raw.folders) || !raw.folders.length) {
		throw new Error('Hermes returned a Project without folders');
	}
	const folders = raw.folders.map((value) => {
		if (!value || typeof value !== 'object')
			throw new Error('Hermes returned an invalid Project folder');
		const folder = value as Record<string, unknown>;
		return {
			path: path(folder.path),
			label: typeof folder.label === 'string' && folder.label.trim() ? folder.label : null,
			is_primary: folder.is_primary === true,
			added_at: typeof folder.added_at === 'number' ? folder.added_at : 0
		};
	});
	const primaryPath = path(raw.primary_path);
	const canonicalFolders = folders.map((folder) => canonicalIfAvailable(folder.path));
	const availableCanonicalFolders = canonicalFolders.filter((folder): folder is string => !!folder);
	if (
		new Set(folders.map((folder) => folder.path)).size !== folders.length ||
		new Set(availableCanonicalFolders).size !== availableCanonicalFolders.length ||
		folders.filter((folder) => folder.is_primary).length !== 1 ||
		!folders.some((folder) => folder.path === primaryPath && folder.is_primary)
	) {
		throw new Error(
			new Set(availableCanonicalFolders).size !== availableCanonicalFolders.length
				? 'Hermes returned a duplicate canonical Project folder'
				: 'Hermes returned an invalid Project primary folder'
		);
	}
	return {
		id: text(raw.id, 'id'),
		name: text(raw.name, 'name'),
		icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : null,
		primary_path: primaryPath,
		folders,
		archived: raw.archived === true
	};
}

export class HermesProjects {
	constructor(
		private readonly transport: ProjectsTransport,
		private readonly profile: string
	) {}

	async list(): Promise<{ projects: HermesProject[]; activeId: string | null }> {
		try {
			const result = await this.request<{ projects?: unknown; active_id?: unknown }>(
				'projects.list',
				this.params()
			);
			if (!Array.isArray(result.projects))
				throw new Error('Hermes returned an invalid Projects list');
			return {
				projects: result.projects.map(normalizeProject),
				activeId: typeof result.active_id === 'string' ? result.active_id : null
			};
		} catch (cause) {
			this.capability(cause);
			throw cause;
		}
	}

	async get(id: string): Promise<HermesProject> {
		try {
			const result = await this.request<{ project?: unknown }>(
				'projects.get',
				this.params({ id: text(id, 'id') })
			);
			return normalizeProject(result.project);
		} catch (cause) {
			this.capability(cause);
			throw cause;
		}
	}

	async create(input: {
		name: string;
		icon?: string | null;
		folders: string[];
		primaryPath: string;
	}): Promise<HermesProject> {
		const name = text(input.name, 'name').trim();
		const folders = input.folders.map(path);
		const folderIdentities = folders.map(
			(folder) => canonicalIfAvailable(folder) ?? resolve(folder)
		);
		if (new Set(folderIdentities).size !== folderIdentities.length) {
			throw new Error('Project folders must be canonically unique');
		}
		const requestedPrimary = path(input.primaryPath);
		const primaryIdentity = canonicalIfAvailable(requestedPrimary) ?? resolve(requestedPrimary);
		const primaryIndex = folderIdentities.indexOf(primaryIdentity);
		if (!folders.length) throw new Error('Project requires at least one folder');
		if (primaryIndex === -1) throw new Error('Primary folder must be one selected folder');
		const primaryPath = folders[primaryIndex];
		try {
			const result = await this.request<{ project?: { id?: unknown } }>(
				'projects.create',
				this.params({
					name,
					...(input.icon ? { icon: input.icon } : {}),
					folders,
					primary_path: primaryPath
				})
			);
			return this.get(text(result.project?.id, 'id'));
		} catch (cause) {
			this.capability(cause);
			throw cause;
		}
	}

	async update(id: string, patch: { name?: string; icon?: string | null }): Promise<HermesProject> {
		await this.request(
			'projects.update',
			this.params({
				id,
				...(patch.name !== undefined ? { name: text(patch.name, 'name').trim() } : {}),
				...(patch.icon !== undefined ? { icon: patch.icon ?? '' } : {})
			})
		);
		return this.get(id);
	}

	async addFolder(
		id: string,
		folderPath: string,
		options: { label?: string | null; isPrimary?: boolean } = {}
	): Promise<HermesProject> {
		const current = await this.get(id);
		const candidateRaw = resolve(folderPath);
		const candidateCanonical = canonicalIfAvailable(folderPath);
		const existing = current.folders.find(
			(folder) =>
				resolve(folder.path) === candidateRaw ||
				(candidateCanonical !== null && canonicalIfAvailable(folder.path) === candidateCanonical)
		);
		if (existing && options.label === undefined) {
			throw new Error('Folder already belongs to Project');
		}
		const rpcPath = existing?.path ?? path(folderPath);
		await this.request(
			'projects.add_folder',
			this.params({
				id,
				path: rpcPath,
				...(options.label !== undefined ? { label: options.label } : {}),
				is_primary: options.isPrimary === true
			})
		);
		return this.get(id);
	}

	async setPrimary(id: string, folderPath: string): Promise<HermesProject> {
		const current = await this.get(id);
		let candidate: string;
		try {
			candidate = rawFolder(current, path(folderPath));
		} catch (cause) {
			if (cause instanceof Error && cause.message === 'Folder does not belong to Project') {
				throw new Error('Primary folder must belong to Project');
			}
			throw cause;
		}
		await this.request('projects.set_primary', this.params({ id, path: candidate }));
		return this.get(id);
	}

	async removeFolder(
		id: string,
		folderPath: string,
		replacementPrimary?: string
	): Promise<HermesProject> {
		let current = await this.get(id);
		const candidate = rawFolder(current, path(folderPath));
		const folder = current.folders.find((item) => item.path === candidate)!;
		if (current.folders.length === 1) throw new Error('Project must keep at least one folder');
		const originalPrimary = current.primary_path;
		if (folder.is_primary) {
			if (!replacementPrimary) throw new Error('Replacement primary folder is required');
			let replacement: string;
			try {
				replacement = rawFolder(current, path(replacementPrimary), candidate);
			} catch (cause) {
				if (cause instanceof Error && cause.message === 'Folder does not belong to Project') {
					throw new Error('Replacement primary folder must belong to Project');
				}
				throw cause;
			}
			if (replacement === candidate) {
				throw new Error('Replacement primary folder must belong to Project');
			}
			await this.request('projects.set_primary', this.params({ id, path: replacement }));
			current = await this.get(id);
			if (current.primary_path !== replacement) {
				throw new Error('Hermes did not apply replacement primary folder');
			}
		}
		try {
			await this.request('projects.remove_folder', this.params({ id, path: candidate }));
		} catch (cause) {
			if (!folder.is_primary) throw cause;
			const removalMessage = cause instanceof Error ? cause.message : String(cause);
			try {
				await this.request('projects.set_primary', this.params({ id, path: originalPrimary }));
				const restored = await this.get(id);
				if (restored.primary_path !== originalPrimary) {
					throw new Error('Hermes did not restore original primary folder');
				}
				throw new HermesProjectMutationError(removalMessage, restored, true, false);
			} catch (compensationCause) {
				if (compensationCause instanceof HermesProjectMutationError) throw compensationCause;
				let authoritative = current;
				try {
					authoritative = await this.get(id);
				} catch {
					// Last verified Hermes readback remains truthful state.
				}
				throw new HermesProjectMutationError(
					`${removalMessage}; primary restoration failed; reconciliation required`,
					authoritative,
					false,
					true
				);
			}
		}
		return this.get(id);
	}

	async archive(id: string): Promise<HermesProject> {
		await this.request('projects.archive', this.params({ id }));
		return this.get(id);
	}

	private params(params: Record<string, unknown> = {}) {
		return { profile: this.profile, ...params };
	}

	private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		try {
			return await this.transport.request<T>(method, params);
		} catch (cause) {
			this.capability(cause);
			throw cause;
		}
	}

	private capability(cause: unknown) {
		if (cause instanceof HermesProjectsRpcError && cause.capabilityMissing) {
			throw new HermesProjectsCapabilityError();
		}
	}
}
