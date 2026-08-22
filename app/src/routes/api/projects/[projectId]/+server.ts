import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json()) as { name?: string; icon?: unknown };
		const name = body.name?.trim();
		if (!name) return json({ error: 'Project name is required' }, { status: 400 });
		const existing = services().store.getProject(params.projectId);
		if (!existing) return json({ error: 'Project not found' }, { status: 404 });
		const project = services().store.updateProject(params.projectId, {
			name,
			icon: 'icon' in body ? validateIcon(body.icon) : existing.icon
		});
		return json({ project });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		return services().store.deleteProject(params.projectId)
			? json({ deleted: true })
			: json({ error: 'Project not found' }, { status: 404 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
	}
};
