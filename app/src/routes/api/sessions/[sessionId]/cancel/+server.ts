import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		await services().runtime.cancelSession(params.sessionId);
		return json({ cancelled: true }, { status: 202 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
