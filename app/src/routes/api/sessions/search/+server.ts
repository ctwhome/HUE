import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { SessionFinderStatus } from '$lib/server/store';
import type { RequestHandler } from './$types';

const statuses = new Set<SessionFinderStatus>([
	'running',
	'waiting',
	'unknown',
	'failed',
	'archived'
]);

export const GET: RequestHandler = ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const requestedStatus = url.searchParams.get('status') ?? '';
	if (requestedStatus && !statuses.has(requestedStatus as SessionFinderStatus)) {
		return json({ error: 'Invalid Session status' }, { status: 400 });
	}
	try {
		return json({
			results: services().store.findSessions(query, requestedStatus as SessionFinderStatus | '', 50)
		});
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
