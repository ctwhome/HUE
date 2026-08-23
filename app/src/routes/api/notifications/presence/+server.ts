import { json } from '@sveltejs/kit';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Notification mutations require same-origin access' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as {
			endpointId?: unknown;
			projectId?: unknown;
			sessionId?: unknown;
			visible?: unknown;
		};
		if (
			typeof body.endpointId !== 'string' ||
			(body.projectId !== null && typeof body.projectId !== 'string') ||
			(body.sessionId !== null && typeof body.sessionId !== 'string') ||
			typeof body.visible !== 'boolean'
		) {
			throw new Error('invalid');
		}
		services().notifications.reportPresence(body.endpointId, {
			projectId: body.projectId,
			sessionId: body.sessionId,
			visible: body.visible
		});
		return new Response(null, { status: 204 });
	} catch {
		return json({ error: 'Invalid presence update' }, { status: 400 });
	}
};
