import { json } from '@sveltejs/kit';
import { ACCESS_COOKIE, sessionCookieOptions } from '$lib/server/access-auth';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url, cookies }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Invalid logout request' }, { status: 403 });
	}
	cookies.delete(ACCESS_COOKIE, sessionCookieOptions());
	return new Response(null, { status: 303, headers: { location: '/login' } });
};
