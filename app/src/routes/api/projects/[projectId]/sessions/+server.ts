import { json } from '@sveltejs/kit';
import { services, sessionMatchesProjectRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		const sessions = (await services().runtime.listSessions(project.rootPath)).filter((session) =>
			sessionMatchesProjectRoot(project.rootPath, session.cwd)
		);
		for (const session of sessions) {
			services().store.upsertProjectSession(project.id, session);
		}
		services().dispatcher.recover();
		return json({ sessions });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		const session = await services().runtime.createSession(project.rootPath);
		if (!sessionMatchesProjectRoot(project.rootPath, session.cwd)) {
			throw new Error(`Hermes Session ${session.sessionId} is outside the Project root`);
		}
		services().store.upsertProjectSession(project.id, session);
		services().dispatcher.recover();
		return json({ session }, { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};
