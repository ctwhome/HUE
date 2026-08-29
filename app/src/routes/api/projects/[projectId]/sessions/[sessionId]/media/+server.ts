import { getMedia, postMedia } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => getMedia(event.params.projectId, event);
export const HEAD: RequestHandler = (event) => getMedia(event.params.projectId, event, true);
export const POST: RequestHandler = (event) => postMedia(event.params.projectId, event);
