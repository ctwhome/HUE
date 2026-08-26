import { json } from '@sveltejs/kit';
import {
	projectRepository,
	projectRepositoryAction,
	projectRepositories,
	resolveProjectRepository,
	projectGitHubItems,
	projectStagedDiff,
	authoritativeProject,
	type ProjectRepositoryAction
} from '$lib/server/services';
import { generateHermesCommitMessage } from '$lib/server/hermes-cli';
import { realpathSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import type { RequestHandler } from './$types';

function repositoryResponse(
	repositoryRoot: string,
	repositoryPath: string,
	repositories: Array<{ path: string; label: string }>
) {
	const status = projectRepository(repositoryRoot);
	return {
		...status,
		changes: status.changes.map((change) => ({
			...change,
			fileUrl:
				change.fileUrl && repositoryPath !== '.'
					? `${repositoryPath}/${change.fileUrl}`
					: change.fileUrl
		})),
		repositoryPath,
		repositories
	};
}

export function _repositoryMutationAllowed(request: Request, clientAddress: string) {
	const address = clientAddress.replace(/^::ffff:/, '');
	if (!['127.0.0.1', '::1'].includes(address)) return false;
	const host = request.headers.get('host');
	const origin = request.headers.get('origin');
	if (!host || !origin) return false;
	try {
		const hostname = new URL(`http://${host}`).hostname;
		return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) && new URL(origin).host === host;
	} catch {
		return false;
	}
}

export function _selectedRepositoryPath(
	repositories: Array<{ path: string }>,
	selected?: string
): string | undefined {
	return repositories.some(({ path }) => path === selected) ? selected : repositories[0]?.path;
}

export function _projectFolderRepositories(
	primaryPath: string,
	folders: string[]
): Array<{ path: string; label: string }> {
	const seen = new Set<string>();
	const primary = realpathSync(primaryPath);
	return folders.flatMap((folder) => {
		const repositories = projectRepositories(folder);
		return repositories.flatMap((repository) => {
			const root = resolveProjectRepository(folder, repository.path, repositories);
			if (seen.has(root)) return [];
			seen.add(root);
			const path = relative(primary, root);
			return [{ path: path ? path.split(sep).join('/') : '.', label: basename(root) }];
		});
	});
}

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const repositories = _projectFolderRepositories(
			project.primary_path,
			project.folders.map(({ path }) => path)
		);
		const selected = _selectedRepositoryPath(
			repositories,
			url.searchParams.get('repository') ?? undefined
		);
		const repositoryPath = selected ?? '.';
		const repositoryRoot = resolveProjectRepository(project.primary_path, selected, repositories);
		if (url.searchParams.get('view') === 'github') {
			return json(projectGitHubItems(repositoryRoot));
		}
		return json(repositoryResponse(repositoryRoot, repositoryPath, repositories));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	if (!_repositoryMutationAllowed(request, getClientAddress())) {
		return json({ error: 'Repository changes are limited to this device' }, { status: 403 });
	}
	try {
		const project = await authoritativeProject(params.projectId);
		const operation = (await request.json()) as
			| (ProjectRepositoryAction & { repository?: string })
			| { action: 'generateCommitMessage'; provider?: string; model?: string; repository?: string };
		const repositories = _projectFolderRepositories(
			project.primary_path,
			project.folders.map(({ path }) => path)
		);
		const repositoryRoot = resolveProjectRepository(
			project.primary_path,
			operation.repository,
			repositories
		);
		const repositoryPath = operation.repository ?? repositories[0]?.path ?? '.';
		if (operation.action === 'generateCommitMessage') {
			const selection =
				operation.provider && operation.model
					? { provider: operation.provider, model: operation.model }
					: undefined;
			const message = await generateHermesCommitMessage(
				repositoryRoot,
				projectStagedDiff(repositoryRoot),
				selection
			);
			return json({ message });
		}
		projectRepositoryAction(repositoryRoot, operation);
		return json(repositoryResponse(repositoryRoot, repositoryPath, repositories));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
