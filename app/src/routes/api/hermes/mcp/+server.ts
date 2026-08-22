import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { HermesAdmin } from '$lib/server/hermes-admin';
import { redactHermesValue } from '$lib/server/redaction';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await new HermesAdmin(services().admin).view('mcp'));
	} catch (cause) {
		return json(
			{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
			{ status: 503 }
		);
	}
};
