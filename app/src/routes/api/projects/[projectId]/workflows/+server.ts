import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/services';
import { parseWorkMode } from '$lib/work-mode';
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
			profile?: string;
			workMode?: unknown;
		};
		const name = body.name?.trim();
		const prompt = body.prompt?.trim();
		if (!name || !prompt)
			return json({ error: 'Workflow name and prompt are required' }, { status: 400 });
		const workMode = body.workMode === undefined ? undefined : parseWorkMode(body.workMode);
		if (body.workMode !== undefined && !workMode)
			return json({ error: 'Invalid work mode' }, { status: 400 });
		const workflow = store.createWorkflow({
			id: crypto.randomUUID(),
			projectId: project.id,
			name,
			prompt,
			profile: body.profile?.trim() || 'default',
			workMode: workMode ?? undefined
		});
		return json({ workflow }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
