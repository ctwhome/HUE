import { json } from '@sveltejs/kit';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export function _withAuthoritativeProjectNames<
	T extends { projectId: string | null; projectName?: string | null }
>(items: T[], projects: Array<{ id: string; name: string }>): T[] {
	const names = new Map(projects.map(({ id, name }) => [id, name]));
	return items.map((item) =>
		item.projectId && names.has(item.projectId)
			? { ...item, projectName: names.get(item.projectId)! }
			: item
	);
}

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
		const notifications = state.store.listNotifications({
			unreadOnly: view === 'unread',
			limit,
			cursor: url.searchParams.get('cursor')
		});
		const projects = await state.projects?.list().catch(() => ({ projects: [] }));
		return json({
			...notifications,
			items: _withAuthoritativeProjectNames(notifications.items, projects?.projects ?? []),
			counts: state.store.notificationCounts(),
			chatIndicators: state.store.getSessionIndicatorCounts(null, 'unscheduled'),
			projectIndicators: Object.fromEntries(
				(projects?.projects ?? []).map(({ id }) => [id, state.store.getSessionIndicatorCounts(id)])
			)
		});
	} catch {
		return json({ error: 'Unable to list notifications' }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ request, url }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Notification mutations require same-origin access' }, { status: 403 });
	}
	const state = services();
	return json({
		updated: state.store.markAllNotificationsRead(),
		counts: state.store.notificationCounts()
	});
};
