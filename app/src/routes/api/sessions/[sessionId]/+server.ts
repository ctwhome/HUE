import {
	copySession,
	deleteSession,
	getSession,
	patchSession
} from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => getSession(null, event);
export const POST: RequestHandler = (event) => copySession(null, event);
export const PATCH: RequestHandler = (event) => patchSession(null, event);
export const DELETE: RequestHandler = (event) => deleteSession(null, event);
