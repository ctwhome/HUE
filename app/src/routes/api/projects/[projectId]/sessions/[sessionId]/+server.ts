import {
	copySession,
	deleteSession,
	getSession,
	patchSession
} from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => getSession(event.params.projectId, event);
export const POST: RequestHandler = (event) => copySession(event.params.projectId, event);
export const PATCH: RequestHandler = (event) => patchSession(event.params.projectId, event);
export const DELETE: RequestHandler = (event) => deleteSession(event.params.projectId, event);
