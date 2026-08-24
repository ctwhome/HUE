import { json } from '@sveltejs/kit';
import {
	projectRepository,
	projectRepositoryAction,
	projectStagedDiff,
	authoritativeProject,
	type ProjectRepositoryAction
} from '$lib/server/services';
import { generateHermesCommitMessage } from '$lib/server/hermes-cli';
import type { RequestHandler } from './$types';

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

export const GET: RequestHandler = async ({ params }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		return json(projectRepository(project.primary_path));
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
			| ProjectRepositoryAction
			| { action: 'generateCommitMessage'; provider?: string; model?: string };
		if (operation.action === 'generateCommitMessage') {
			const selection =
				operation.provider && operation.model
					? { provider: operation.provider, model: operation.model }
					: undefined;
			const message = await generateHermesCommitMessage(
				project.primary_path,
				projectStagedDiff(project.primary_path),
				selection
			);
			return json({ message });
		}
		return json(projectRepositoryAction(project.primary_path, operation));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
