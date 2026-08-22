import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/route-services';
import type { BrowserInteractionResponse } from '$lib/server/message-dispatcher';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	let body: { interactionId?: unknown; response?: BrowserInteractionResponse };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Invalid interaction response' }, { status: 400 });
	}
	if (!body || typeof body.interactionId !== 'string' || !body.response) {
		return json({ error: 'Invalid interaction response' }, { status: 400 });
	}
	const resolved = services().dispatcher.resolveInteraction(
		project.id,
		params.sessionId,
		body.interactionId,
		body.response
	);
	return resolved
		? json({ resolved: true })
		: json({ error: 'Interaction is unavailable or response is invalid' }, { status: 409 });
};
