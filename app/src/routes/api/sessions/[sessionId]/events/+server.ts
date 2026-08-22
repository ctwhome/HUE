import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const rawAfter = Number(url.searchParams.get('after') ?? '0');
	const after = Number.isSafeInteger(rawAfter) && rawAfter >= 0 ? rawAfter : 0;
	return json({
		events: services().store.listEvents(null, params.sessionId, after),
		runtime: services().runtime.getSessionState(params.sessionId)
	});
};
