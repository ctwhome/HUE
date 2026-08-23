import { json } from '@sveltejs/kit';
import {
	projectRepository,
	projectRepositoryAction,
	authoritativeProject,
	type ProjectRepositoryAction
} from '$lib/server/services';
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
		const operation = (await request.json()) as ProjectRepositoryAction;
		return json(projectRepositoryAction(project.primary_path, operation));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
