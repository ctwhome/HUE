import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const view = url.searchParams.get('view') ?? 'unread';
		if (view !== 'unread' && view !== 'all') {
			return json({ error: 'Invalid notification view' }, { status: 400 });
		}
		const limit = Number(url.searchParams.get('limit') ?? 50);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			return json({ error: 'Notification limit must be 1-100' }, { status: 400 });
		}
		const state = services();
		void state.notifications.deliverPending();
		return json({
			...state.store.listNotifications({
				unreadOnly: view === 'unread',
				limit,
				cursor: url.searchParams.get('cursor')
			}),
			counts: state.store.notificationCounts()
		});
	} catch {
		return json({ error: 'Unable to list notifications' }, { status: 400 });
	}
};
