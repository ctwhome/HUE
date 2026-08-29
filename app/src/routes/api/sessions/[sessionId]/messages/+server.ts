import { patchMessage, postMessage } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => postMessage(null, event);
export const PATCH: RequestHandler = (event) => patchMessage(null, event);
