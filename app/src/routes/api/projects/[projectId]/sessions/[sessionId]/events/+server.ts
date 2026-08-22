import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const rawAfter = Number(url.searchParams.get('after') ?? '0');
	const after = Number.isSafeInteger(rawAfter) && rawAfter >= 0 ? rawAfter : 0;
	return json({
		events: services().store.listEvents(project.id, params.sessionId, after),
		runtime: services().runtime.getSessionState(params.sessionId)
	});
};
