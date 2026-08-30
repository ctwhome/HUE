import { json } from '@sveltejs/kit';
import { redactHermesValue } from '$lib/server/redaction';
import { localSameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

const failure = (cause: unknown, status = 400) =>
	json(
		{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
		{ status }
	);

export const GET: RequestHandler = async () => {
	try {
		const bundles = services().bundles;
		const [items, skills] = await Promise.all([bundles.list(), bundles.listSkills()]);
		return json({ bundles: items, skills });
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (!localSameOriginMutationAllowed(request, url, getClientAddress())) {
		return failure('API access is limited to this device', 403);
	}
	try {
		return json({ bundle: await services().bundles.create(await request.json()) }, { status: 201 });
	} catch (cause) {
		return failure(cause);
	}
};
