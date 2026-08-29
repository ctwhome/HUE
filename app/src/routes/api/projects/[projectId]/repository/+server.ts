import { json } from '@sveltejs/kit';
import {
	projectRepository,
	projectRepositoryAction,
	projectRepositoryDiff,
	projectRepositories,
	resolveProjectRepository,
	projectGitHubItems,
	projectStagedDiff,
	authoritativeProject,
	services,
	type ProjectRepositoryAction,
	type ProjectRepositoryDiffScope
} from '$lib/server/services';
import { commitModelId, generateRepositoryCommitMessage } from '$lib/server/commit-generation';
import { localSameOriginMutationAllowed } from '$lib/server/same-origin';
import { basename, join } from 'node:path';
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

export function _selectedRepositoryPath(
	repositories: Array<{ path: string }>,
	selected?: string,
	strict = false
): string | undefined {
	if (strict && selected && !repositories.some(({ path }) => path === selected)) {
		throw new Error('Repository is not part of this project');
	}
	return repositories.some(({ path }) => path === selected) ? selected : repositories[0]?.path;
}

export function _repositoryDiffOptions(searchParams: URLSearchParams): {
	scope: ProjectRepositoryDiffScope;
	base?: string;
	file?: string;
} {
	const scope = searchParams.get('scope') ?? 'unstaged';
	if (!['staged', 'unstaged', 'branch'].includes(scope)) throw new Error('Invalid diff scope');
	return {
		scope: scope as ProjectRepositoryDiffScope,
		...(searchParams.get('base') ? { base: searchParams.get('base')! } : {}),
		...(searchParams.get('file') ? { file: searchParams.get('file')! } : {})
	};
}

export function _projectFolderRepositories(
	primaryPath: string
): Array<{ path: string; label: string }> {
	return projectRepositories(primaryPath).map(({ path }) => ({
		path,
		label: basename(path === '.' ? primaryPath : join(primaryPath, path))
	}));
}

export function _commitModelSelection(provider?: string, model?: string): string {
	if (!provider || !model) throw new Error('Commit model is required');
	return commitModelId(provider, model);
}

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const repositories = _projectFolderRepositories(project.primary_path);
		const view = url.searchParams.get('view');
		const selected = _selectedRepositoryPath(
			repositories,
			url.searchParams.get('repository') ?? undefined,
			view === 'diff'
		);
		const repositoryPath = selected ?? '.';
		const repositoryRoot = resolveProjectRepository(project.primary_path, selected, repositories);
		if (view === 'github') {
			return json(projectGitHubItems(repositoryRoot));
		}
		if (view === 'diff')
			return json(projectRepositoryDiff(repositoryRoot, _repositoryDiffOptions(url.searchParams)));
		return json(repositoryResponse(repositoryRoot, repositoryPath, repositories));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!localSameOriginMutationAllowed(request, url, getClientAddress())) {
		return json({ error: 'Repository changes are limited to this device' }, { status: 403 });
	}
	try {
		const project = await authoritativeProject(params.projectId);
		const operation = (await request.json()) as
			| (ProjectRepositoryAction & { repository?: string })
			| {
					action: 'generateCommitMessage';
					provider?: string;
					model?: string;
					repository?: string;
					operationId?: string;
			  };
		const repositories = _projectFolderRepositories(project.primary_path);
		const repositoryRoot = resolveProjectRepository(
			project.primary_path,
			operation.repository,
			repositories
		);
		const repositoryPath = operation.repository ?? repositories[0]?.path ?? '.';
		if (operation.action === 'generateCommitMessage') {
			if (!operation.operationId) throw new Error('Commit generation operation id is required');
			const state = services();
			return json(
				await generateRepositoryCommitMessage(
					{
						projectId: project.id,
						repositoryRoot,
						diff: projectStagedDiff(repositoryRoot),
						modelId: _commitModelSelection(operation.provider, operation.model),
						operationId: operation.operationId
					},
					state
				)
			);
		}
		projectRepositoryAction(repositoryRoot, operation);
		return json(repositoryResponse(repositoryRoot, repositoryPath, repositories));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
