import { postInteraction } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => postInteraction(event.params.projectId, event);
