import { fail, redirect } from '@sveltejs/kit';
import {
	ACCESS_COOKIE,
	createAccessSession,
	secretsEqual,
	sessionCookieOptions
} from '$lib/server/access-auth';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, url, cookies }) => {
		if (!sameOriginMutationAllowed(request, url)) {
			return fail(403, { error: 'Invalid login request' });
		}
		const secret = process.env.HUE_ACCESS_SECRET;
		if (!secret) return fail(403, { error: 'Remote access is not configured' });
		const candidate = (await request.formData()).get('secret');
		if (typeof candidate !== 'string' || !secretsEqual(candidate, secret)) {
			return fail(400, { error: 'Invalid access secret' });
		}
		cookies.set(ACCESS_COOKIE, createAccessSession(secret), sessionCookieOptions());
		redirect(303, '/');
	}
};
