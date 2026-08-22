import { json } from '@sveltejs/kit';
import { projectView, services, trustedProjectRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	json({ projects: services().store.listProjects().map(projectView) });

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { name?: string; rootPath?: string };
		const name = body.name?.trim();
		if (!name) return json({ error: 'Project name is required' }, { status: 400 });
		const rootPath = trustedProjectRoot(body.rootPath ?? '');
		const project = services().store.createProject({
			id: crypto.randomUUID(),
			name,
			rootPath
		});
		return json({ project: projectView(project) }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
