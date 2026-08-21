import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	if (!services().store.getProject(params.projectId)) {
		return json({ error: 'Project not found' }, { status: 404 });
	}
	return json({ workflows: services().store.listWorkflows(params.projectId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const store = services().store;
	if (!store.getProject(params.projectId))
		return json({ error: 'Project not found' }, { status: 404 });
	try {
		const body = (await request.json()) as { name?: string; prompt?: string; profile?: string };
		const name = body.name?.trim();
		const prompt = body.prompt?.trim();
		if (!name || !prompt)
			return json({ error: 'Workflow name and prompt are required' }, { status: 400 });
		const workflow = store.createWorkflow({
			id: crypto.randomUUID(),
			projectId: params.projectId,
			name,
			prompt,
			profile: body.profile?.trim() || 'default'
		});
		return json({ workflow }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
