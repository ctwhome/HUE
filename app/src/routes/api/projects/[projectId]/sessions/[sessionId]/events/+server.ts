import { getEvents } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => getEvents(event.params.projectId, event);
