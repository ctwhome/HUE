import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { BrowserInteractionResponse } from '$lib/server/message-dispatcher';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
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
		null,
		params.sessionId,
		body.interactionId,
		body.response
	);
	return resolved
		? json({ resolved: true })
		: json({ error: 'Interaction is unavailable or response is invalid' }, { status: 409 });
};
