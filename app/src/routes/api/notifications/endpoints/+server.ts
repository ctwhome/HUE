import { json } from '@sveltejs/kit';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json({ endpoints: services().notifications.listEndpoints() });

export const POST: RequestHandler = async ({ request, url }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Notification mutations require same-origin access' }, { status: 403 });
	}
	try {
		const notifications = services().notifications;
		const endpoint = notifications.upsertEndpoint(await request.json());
		void notifications.deliverPending();
		return json(endpoint);
	} catch {
		return json({ error: 'Invalid push subscription' }, { status: 400 });
	}
};
