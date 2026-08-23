import { json } from '@sveltejs/kit';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

function guarded(request: Request, url: URL) {
	return sameOriginMutationAllowed(request, url)
		? null
		: json({ error: 'Notification mutations require same-origin access' }, { status: 403 });
}

export const PATCH: RequestHandler = async ({ params, request, url }) => {
	const denied = guarded(request, url);
	if (denied) return denied;
	try {
		const body = (await request.json()) as { name?: unknown; enabled?: unknown; revoke?: unknown };
		return json(
			body.revoke === true
				? services().notifications.revokeEndpoint(params.endpointId)
				: services().notifications.updateEndpoint(params.endpointId, {
						name: body.name as string | undefined,
						enabled: body.enabled as boolean | undefined
					})
		);
	} catch {
		return json({ error: 'Invalid notification endpoint mutation' }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params, request, url }) => {
	const denied = guarded(request, url);
	if (denied) return denied;
	return services().notifications.deleteEndpoint(params.endpointId)
		? json({ deleted: true })
		: json({ error: 'Notification endpoint not found' }, { status: 404 });
};
