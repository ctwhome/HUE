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

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json({ bundle: await services().bundles.get(params.name) });
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!localSameOriginMutationAllowed(request, url, getClientAddress())) {
		return failure('API access is limited to this device', 403);
	}
	try {
		return json({ bundle: await services().bundles.update(params.name, await request.json()) });
	} catch (cause) {
		return failure(cause);
	}
};

export const DELETE: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!localSameOriginMutationAllowed(request, url, getClientAddress())) {
		return failure('API access is limited to this device', 403);
	}
	try {
		const body = (await request.json()) as { confirm?: unknown };
		const bundle = await services().bundles.get(params.name);
		if (body.confirm !== bundle.name) return failure(`Type ${bundle.name} to confirm deletion`);
		return json(await services().bundles.delete(params.name));
	} catch (cause) {
		return failure(cause);
	}
};
