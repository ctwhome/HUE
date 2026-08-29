import { getMedia, postMedia } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => getMedia(null, event);
export const HEAD: RequestHandler = (event) => getMedia(null, event, true);
export const POST: RequestHandler = (event) => postMedia(null, event);
