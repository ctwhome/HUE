import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		return json({ workflows: services().store.listWorkflows(project.id) });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const store = services().store;
	try {
		const project = await authoritativeProject(params.projectId);
		const body = (await request.json()) as { name?: string; prompt?: string; profile?: string };
		const name = body.name?.trim();
		const prompt = body.prompt?.trim();
		if (!name || !prompt)
			return json({ error: 'Workflow name and prompt are required' }, { status: 400 });
		const workflow = store.createWorkflow({
			id: crypto.randomUUID(),
			projectId: project.id,
			name,
			prompt,
			profile: body.profile?.trim() || 'default'
		});
		return json({ workflow }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
