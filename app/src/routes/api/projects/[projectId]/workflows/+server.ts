import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/services';
import { parseBundleReference } from '$lib/bundle';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		return json({
			workflows: services().store.listWorkflows(
				project.id,
				url.searchParams.get('archived') === 'true'
			)
		});
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const store = services().store;
	try {
		const project = await authoritativeProject(params.projectId);
		const body = (await request.json()) as {
			name?: string;
			prompt?: string;
			folder?: unknown;
			favorite?: unknown;
			profile?: string;
			bundle?: unknown;
		};
		const name = body.name?.trim();
		const prompt = body.prompt?.trim();
		if (!name || !prompt)
			return json({ error: 'Workflow name and prompt are required' }, { status: 400 });
		if (
			body.folder !== undefined &&
			(typeof body.folder !== 'string' || body.folder.trim().length > 100)
		)
			return json({ error: 'Folder must be at most 100 characters' }, { status: 400 });
		if (body.favorite !== undefined && typeof body.favorite !== 'boolean')
			return json({ error: 'favorite must be a boolean' }, { status: 400 });
		const bundle = body.bundle === undefined ? undefined : parseBundleReference(body.bundle);
		if (body.bundle !== undefined && !bundle)
			return json({ error: 'Invalid bundle reference' }, { status: 400 });
		const workflow = store.createWorkflow({
			id: crypto.randomUUID(),
			projectId: project.id,
			name,
			prompt,
			folder: typeof body.folder === 'string' ? body.folder.trim() || null : null,
			favorite: body.favorite === true,
			profile: body.profile?.trim() || 'default',
			bundle: bundle ?? undefined
		});
		return json({ workflow }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
