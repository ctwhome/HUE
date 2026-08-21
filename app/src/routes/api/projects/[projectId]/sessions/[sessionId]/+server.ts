import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasProjectSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const snapshot = services().store.getSessionSnapshot(params.projectId, params.sessionId);
	try {
		const transcript = await services().runtime.loadTranscript(project.rootPath, params.sessionId);
		return json({
			transcript,
			commands: services().runtime.getAvailableCommands(params.sessionId),
			...snapshot
		});
	} catch (error) {
		if (snapshot.messages.length) {
			return json({
				transcript: [],
				transcriptError: error instanceof Error ? error.message : String(error),
				...snapshot
			});
		}
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
	}
};
