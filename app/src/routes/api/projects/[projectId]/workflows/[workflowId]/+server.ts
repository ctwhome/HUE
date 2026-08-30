import { json } from '@sveltejs/kit';
import { parseBundleReference } from '$lib/bundle';
import { authoritativeProject, services } from '$lib/server/services';
import type { Workflow } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const body = (await request.json()) as Record<string, unknown>;
		const patch: Partial<
			Pick<Workflow, 'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'bundle' | 'archived'>
		> = {};
		for (const field of ['name', 'prompt', 'profile'] as const) {
			if (field in body) {
				if (typeof body[field] !== 'string' || !body[field].trim())
					return json({ error: `${field} is required` }, { status: 400 });
				patch[field] = body[field].trim();
			}
		}
		if ('folder' in body) {
			if (
				body.folder !== null &&
				(typeof body.folder !== 'string' || body.folder.trim().length > 100)
			)
				return json({ error: 'Folder must be null or at most 100 characters' }, { status: 400 });
			patch.folder = typeof body.folder === 'string' ? body.folder.trim() || null : null;
		}
		if ('bundle' in body) {
			const bundle = parseBundleReference(body.bundle);
			if (!bundle) return json({ error: 'Invalid bundle reference' }, { status: 400 });
			patch.bundle = bundle;
		}
		if ('archived' in body) {
			if (typeof body.archived !== 'boolean')
				return json({ error: 'archived must be a boolean' }, { status: 400 });
			patch.archived = body.archived;
		}
		if ('favorite' in body) {
			if (typeof body.favorite !== 'boolean')
				return json({ error: 'favorite must be a boolean' }, { status: 400 });
			patch.favorite = body.favorite;
		}
		if (!Object.keys(patch).length)
			return json({ error: 'No workflow changes supplied' }, { status: 400 });
		const workflow = services().store.updateWorkflow(project.id, params.workflowId, patch);
		return workflow ? json({ workflow }) : json({ error: 'Workflow not found' }, { status: 404 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		return services().store.deleteWorkflow(project.id, params.workflowId)
			? json({ deleted: true })
			: json({ error: 'Workflow not found' }, { status: 404 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
