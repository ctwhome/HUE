import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await services().admin.mcpServers());
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
