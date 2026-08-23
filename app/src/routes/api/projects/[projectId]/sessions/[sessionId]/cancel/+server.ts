import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		await services().runtime.cancelSession(params.sessionId);
		return json({ cancelled: true }, { status: 202 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
