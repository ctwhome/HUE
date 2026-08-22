import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { projectView, services, trustedProjectRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json()) as { name?: unknown; icon?: unknown; rootPath?: unknown };
		const existing = services().store.getProject(params.projectId);
		if (!existing) return json({ error: 'Project not found' }, { status: 404 });
		if (body.name !== undefined && typeof body.name !== 'string') {
			return json({ error: 'Project name must be text' }, { status: 400 });
		}
		if (body.rootPath !== undefined && typeof body.rootPath !== 'string') {
			return json({ error: 'Project root must be a path' }, { status: 400 });
		}
		const name = body.name === undefined ? existing.name : body.name.trim();
		if (!name) return json({ error: 'Project name is required' }, { status: 400 });
		const rootPath =
			body.rootPath === undefined ? existing.rootPath : trustedProjectRoot(body.rootPath);
		const icon = 'icon' in body ? validateIcon(body.icon) : existing.icon;
		const project = services().store.updateProject(params.projectId, {
			name,
			icon,
			rootPath
		})!;
		if (rootPath !== existing.rootPath) services().terminals.closeProject(params.projectId);
		return json({ project: projectView(project) });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		if (!services().store.deleteProject(params.projectId)) {
			return json({ error: 'Project not found' }, { status: 404 });
		}
		services().terminals.closeProject(params.projectId);
		return json({ deleted: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
	}
};
