import { patchMessage, postMessage } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => postMessage(event.params.projectId, event);
export const PATCH: RequestHandler = (event) => patchMessage(event.params.projectId, event);
