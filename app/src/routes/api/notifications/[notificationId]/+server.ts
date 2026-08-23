import { json } from '@sveltejs/kit';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, url }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Notification mutations require same-origin access' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as { state?: unknown };
		if (!['read', 'dismissed', 'acted'].includes(String(body.state))) {
			return json({ error: 'Invalid notification state' }, { status: 400 });
		}
		return json(
			services().store.updateNotification(
				params.notificationId,
				body.state as 'read' | 'dismissed' | 'acted'
			)
		);
	} catch (cause) {
		return json(
			{
				error:
					cause instanceof Error && cause.message === 'Notification not found'
						? cause.message
						: 'Invalid notification mutation'
			},
			{ status: cause instanceof Error && cause.message === 'Notification not found' ? 404 : 400 }
		);
	}
};
