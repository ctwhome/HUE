import { json, type Handle } from '@sveltejs/kit';
import { localApiAllowed } from '$lib/server/local-api';

export const handle: Handle = async ({ event, resolve }) => {
	if (
		event.url.pathname.startsWith('/api/') &&
		!localApiAllowed(event.request, event.url, event.getClientAddress())
	) {
		return json({ error: 'API access is limited to this device' }, { status: 403 });
	}
	return resolve(event);
};
