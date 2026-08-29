import { postCancel } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => postCancel(event.params.projectId, event);
