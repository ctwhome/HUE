import { improvePrompt } from '$lib/server/session-route-handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => improvePrompt(null, event);
