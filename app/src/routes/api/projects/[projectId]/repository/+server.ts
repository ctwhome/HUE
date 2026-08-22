import { json } from '@sveltejs/kit';
import {
	projectRepository,
	projectRepositoryAction,
	services,
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

export const GET: RequestHandler = ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		return json(projectRepository(project.rootPath));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	if (!_repositoryMutationAllowed(request, getClientAddress())) {
		return json({ error: 'Repository changes are limited to this device' }, { status: 403 });
	}
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		const operation = (await request.json()) as ProjectRepositoryAction;
		return json(projectRepositoryAction(project.rootPath, operation));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
